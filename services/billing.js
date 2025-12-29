import db from './database.js';

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
      // Get base billing info
      const billingResult = await db.query(`
        SELECT usage_limit, current_usage, current_plan, billing_status
        FROM billing_accounts 
        WHERE user_id = $1
      `, [userId]);

      if (billingResult.rows.length === 0) {
        throw new Error('Billing account not found');
      }

      const billing = billingResult.rows[0];

      // Get active referral rewards
      const rewardsResult = await db.query(`
        SELECT SUM(reward_value) as total_reward_value, COUNT(*) as reward_count
        FROM referral_rewards 
        WHERE user_id = $1 AND status = 'active'
      `, [userId]);

      const totalRewardValue = parseFloat(rewardsResult.rows[0].total_reward_value || 0);
      const bonusCredits = Math.floor(totalRewardValue / this.rewardValuePerPost);

      return {
        basePlan: billing.current_plan,
        baseCredits: parseInt(billing.usage_limit),
        bonusCredits,
        totalCredits: parseInt(billing.usage_limit) + bonusCredits,
        usedCredits: parseInt(billing.current_usage),
        availableCredits: parseInt(billing.usage_limit) + bonusCredits - parseInt(billing.current_usage),
        rewardValue: totalRewardValue,
        billingStatus: billing.billing_status
      };
    } catch (error) {
      console.error('Error getting user credits:', error);
      throw error;
    }
  }

  /**
   * Use a credit for content generation
   */
  async useCredit(userId, contentType = 'blog_post') {
    try {
      const credits = await this.getUserCredits(userId);

      if (credits.availableCredits <= 0) {
        throw new Error('No credits available');
      }

      // Increment usage
      await db.query(`
        UPDATE billing_accounts 
        SET current_usage = current_usage + 1
        WHERE user_id = $1
      `, [userId]);

      // If we used a bonus credit (beyond base plan), mark rewards as used
      if (credits.usedCredits >= credits.baseCredits) {
        await this.markRewardAsUsed(userId);
      }

      return {
        success: true,
        creditsRemaining: credits.availableCredits - 1
      };
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