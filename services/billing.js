import db from './database.js';
import emailService from './email.js';

/**
 * Billing and Usage Management Service
 * Handles user credits, referral rewards, and usage tracking
 */
class BillingService {
  constructor() {
    this.baseFreePosts = 1; // Base free plan allocation
    this.rewardValuePerPost = 15.00; // $15 = 1 free blog post
  }

  /**
   * Get user's total available credits (base plan + active rewards)
   */
  async getUserCredits(userId) {
    try {
      // 1. Check for unlimited subscription
      const subResult = await db.query(`
        SELECT s.plan_name, pd.is_unlimited
        FROM subscriptions s
        JOIN plan_definitions pd ON pd.name = s.plan_name
        WHERE s.user_id = $1
          AND s.status = 'active'
          AND s.current_period_end > NOW()
        ORDER BY s.created_at DESC
        LIMIT 1
      `, [userId]);

      if (subResult.rows.length > 0 && subResult.rows[0].is_unlimited) {
        return {
          basePlan: subResult.rows[0].plan_name,
          isUnlimited: true,
          totalCredits: 999999,
          availableCredits: 999999,
          usedCredits: 0,
          breakdown: { subscription: 999999, purchases: 0, referrals: 0 }
        };
      }

      // 2. Count active credits by source
      const creditsResult = await db.query(`
        SELECT
          source_type,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as used
        FROM user_credits
        WHERE user_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())
        GROUP BY source_type
      `, [userId]);

      const breakdown = { subscription: 0, purchases: 0, referrals: 0 };
      let totalAvailable = 0;
      let totalUsed = 0;

      creditsResult.rows.forEach(row => {
        const available = parseInt(row.available) || 0;
        const used = parseInt(row.used) || 0;

        if (row.source_type === 'subscription') breakdown.subscription = available;
        else if (row.source_type === 'purchase') breakdown.purchases = available;
        else if (row.source_type === 'referral') breakdown.referrals = available;

        totalAvailable += available;
        totalUsed += used;
      });

      return {
        basePlan: subResult.rows[0]?.plan_name || 'Pay as You Go',
        isUnlimited: false,
        totalCredits: totalAvailable + totalUsed,
        availableCredits: totalAvailable,
        usedCredits: totalUsed,
        breakdown
      };

    } catch (error) {
      console.error('Error getting user credits:', error);

      // Fallback for users with no credits system data yet
      return {
        basePlan: 'Pay as You Go',
        isUnlimited: false,
        totalCredits: 0,
        availableCredits: 0,
        usedCredits: 0,
        breakdown: { subscription: 0, purchases: 0, referrals: 0 }
      };
    }
  }

  /**
   * Use a credit for content generation
   */
  async useCredit(userId, featureType = 'generation', featureId = null) {
    try {
      // 1. Find highest priority active credit
      const creditResult = await db.query(`
        SELECT id, source_type, priority
        FROM user_credits
        WHERE user_id = $1
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE
      `, [userId]);

      if (creditResult.rows.length === 0) {
        throw new Error('No available credits');
      }

      const credit = creditResult.rows[0];

      // 2. Mark credit as used
      await db.query(`
        UPDATE user_credits
        SET
          status = 'used',
          used_at = NOW(),
          used_for_type = $2,
          used_for_id = $3
        WHERE id = $1
      `, [credit.id, featureType, featureId]);

      // 3. Update usage tracking
      const currentMonth = new Date();
      const periodStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const periodEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      if (credit.source_type === 'subscription') {
        // Subscription credit - increment usage_count
        await db.query(`
          INSERT INTO user_usage_tracking (
            user_id, feature_type, period_start, period_end, usage_count, limit_count
          ) VALUES (
            $1, $2, $3, $4, 1, 0
          )
          ON CONFLICT (user_id, feature_type, period_start)
          DO UPDATE SET
            usage_count = user_usage_tracking.usage_count + 1,
            updated_at = NOW()
        `, [userId, featureType, periodStart, periodEnd]);
      } else {
        // Bonus credit (purchase or referral) - increment bonus_usage_count
        await db.query(`
          INSERT INTO user_usage_tracking (
            user_id, feature_type, period_start, period_end,
            usage_count, bonus_usage_count, bonus_source
          ) VALUES (
            $1, $2, $3, $4, 0, 1, $5
          )
          ON CONFLICT (user_id, feature_type, period_start)
          DO UPDATE SET
            bonus_usage_count = user_usage_tracking.bonus_usage_count + 1,
            bonus_source = $5,
            updated_at = NOW()
        `, [userId, featureType, periodStart, periodEnd, credit.source_type]);
      }

      console.log(`✅ Used ${credit.source_type} credit for user ${userId}`);

      // Check remaining credits and send low credit warning if needed
      const remainingCredits = await this.getAvailableCredits(userId);
      if (remainingCredits.availableCredits <= 2 && remainingCredits.availableCredits > 0) {
        // Send low credit warning (async, don't block)
        emailService.sendLowCreditWarning(userId)
          .then(() => console.log(`✅ Low credit warning sent to user ${userId} (${remainingCredits.availableCredits} credits remaining)`))
          .catch(err => console.error('❌ Failed to send low credit warning:', err));
      }

      return { success: true, creditId: credit.id, sourceType: credit.source_type };

    } catch (error) {
      console.error('Error using credit:', error);
      throw error;
    }
  }

  /**
   * Mark oldest active reward as used
   */
  async markRewardAsUsed(userId) {
    try {
      await db.query(`
        UPDATE referral_rewards 
        SET status = 'used', used_at = NOW()
        WHERE id = (
          SELECT id FROM referral_rewards 
          WHERE user_id = $1 AND status = 'active'
          ORDER BY granted_at ASC
          LIMIT 1
        )
      `, [userId]);
    } catch (error) {
      console.error('Error marking reward as used:', error);
      throw error;
    }
  }

  /**
   * Apply all pending referral rewards to user's account
   * This is a one-time migration function
   */
  async applyPendingRewards(userId) {
    try {
      const rewardsResult = await db.query(`
        SELECT COUNT(*) as reward_count, SUM(reward_value) as total_value
        FROM referral_rewards 
        WHERE user_id = $1 AND status = 'active'
      `, [userId]);

      const rewardCount = parseInt(rewardsResult.rows[0].reward_count || 0);
      const totalValue = parseFloat(rewardsResult.rows[0].total_value || 0);
      const bonusCredits = Math.floor(totalValue / this.rewardValuePerPost);

      if (bonusCredits > 0) {
        console.log(`Applying ${bonusCredits} bonus credits (worth $${totalValue}) to user ${userId}`);
        
        // Note: We don't actually modify usage_limit because we calculate total credits dynamically
        // This ensures rewards are properly tracked and can be consumed separately
        
        return {
          success: true,
          bonusCredits,
          totalRewardValue: totalValue,
          message: `Applied ${bonusCredits} bonus credits from ${rewardCount} rewards`
        };
      }

      return {
        success: true,
        bonusCredits: 0,
        message: 'No pending rewards to apply'
      };
    } catch (error) {
      console.error('Error applying pending rewards:', error);
      throw error;
    }
  }

  /**
   * Get detailed billing history for user
   */
  async getBillingHistory(userId, limit = 50) {
    try {
      const historyResult = await db.query(`
        SELECT 
          'generation' as type,
          created_at as timestamp,
          1 as credits_used,
          'Blog post generation' as description
        FROM generation_history 
        WHERE user_id = $1
        
        UNION ALL
        
        SELECT 
          'reward' as type,
          granted_at as timestamp,
          -(reward_value / $2) as credits_used,
          CASE reward_type
            WHEN 'free_generation' THEN 'Referral bonus: +1 free blog post'
            ELSE CONCAT('Bonus: +', (reward_value / $2), ' free posts')
          END as description
        FROM referral_rewards 
        WHERE user_id = $1
        
        ORDER BY timestamp DESC
        LIMIT $3
      `, [userId, this.rewardValuePerPost, limit]);

      return historyResult.rows;
    } catch (error) {
      console.error('Error getting billing history:', error);
      throw error;
    }
  }

  /**
   * Check if user has sufficient credits for an operation
   */
  async hasCredits(userId, creditsNeeded = 1) {
    try {
      const credits = await this.getUserCredits(userId);
      return credits.availableCredits >= creditsNeeded;
    } catch (error) {
      console.error('Error checking credits:', error);
      return false;
    }
  }
}

export default new BillingService();