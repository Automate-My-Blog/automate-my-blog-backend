import { v4 as uuidv4 } from 'uuid';
import db from './database.js';
import emailService from './email.js';

/**
 * Referral System Service
 * Handles both referral invites (for rewards) and organization invites (for team building)
 */
class ReferralService {
  constructor() {
    this.rewardValues = {
      'free_generation': 15.00, // $15 value
      'bonus_strategies': 10.00,
      'month_free': 25.00
    };
  }

  /**
   * Generate personal referral link for user
   */
  async generateReferralLink(userId, baseUrl = 'https://automatemyblog.com') {
    try {
      // Get user's referral code
      const userResult = await db.query(
        'SELECT referral_code FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const referralCode = userResult.rows[0].referral_code;
      const referralLink = `${baseUrl}/?ref=${referralCode}`;

      return {
        referralCode,
        referralLink,
        description: 'Share this link to earn 1 free blog post for each new customer!'
      };
    } catch (error) {
      console.error('Error generating referral link:', error);
      throw error;
    }
  }

  /**
   * Send referral invitation (for customer acquisition - rewards given)
   */
  async sendReferralInvite(inviterUserId, email, personalMessage = '') {
    try {
      // Get inviter's info
      const inviterResult = await db.query(
        'SELECT email, first_name, last_name, referral_code FROM users WHERE id = $1',
        [inviterUserId]
      );

      if (inviterResult.rows.length === 0) {
        throw new Error('Inviter not found');
      }

      const inviter = inviterResult.rows[0];

      // Check if email is already invited or registered
      const existingUserResult = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (existingUserResult.rows.length > 0) {
        throw new Error('This email is already registered');
      }

      const existingInviteResult = await db.query(
        'SELECT id FROM user_invites WHERE email = $1 AND status = $2',
        [email.toLowerCase(), 'pending']
      );

      if (existingInviteResult.rows.length > 0) {
        throw new Error('This email already has a pending invitation');
      }

      // Create referral invite
      const inviteId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

      const inviteResult = await db.query(`
        INSERT INTO user_invites (
          id, inviter_user_id, email, invite_type, expires_at, sent_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING invite_code
      `, [inviteId, inviterUserId, email.toLowerCase(), 'referral', expiresAt]);

      const inviteCode = inviteResult.rows[0].invite_code;

      // Send referral invitation email
      try {
        await emailService.sendReferralInvitation(inviterUserId, email, inviteCode);
        console.log(`✅ Referral invitation email sent to ${email}`);
      } catch (emailError) {
        console.error('❌ Failed to send referral invitation email:', emailError);
        // Don't throw - invitation was created, email failure shouldn't block the response
      }

      return {
        inviteId,
        inviteCode,
        inviterName: `${inviter.first_name} ${inviter.last_name}`,
        inviterEmail: inviter.email,
        email,
        personalMessage,
        expiresAt,
        inviteLink: `https://automatemyblog.com/signup?invite=${inviteCode}`
      };
    } catch (error) {
      console.error('Error sending referral invite:', error);
      throw error;
    }
  }

  /**
   * Send organization invitation (for team building - no rewards)
   */
  async sendOrganizationInvite(inviterUserId, email, role = 'member') {
    try {
      // Get inviter's organization info
      const inviterResult = await db.query(`
        SELECT u.email, u.first_name, u.last_name, om.organization_id, o.name as org_name
        FROM users u
        LEFT JOIN organization_members om ON u.id = om.user_id
        LEFT JOIN organizations o ON om.organization_id = o.id
        WHERE u.id = $1 AND om.role IN ('owner', 'admin')
      `, [inviterUserId]);

      if (inviterResult.rows.length === 0) {
        throw new Error('User not found or not authorized to invite team members');
      }

      const inviter = inviterResult.rows[0];

      // Check if email is already in organization
      const existingMemberResult = await db.query(`
        SELECT u.id FROM users u
        JOIN organization_members om ON u.id = om.user_id
        WHERE u.email = $1 AND om.organization_id = $2
      `, [email.toLowerCase(), inviter.organization_id]);

      if (existingMemberResult.rows.length > 0) {
        throw new Error('This email is already a member of your organization');
      }

      // Create organization invite
      const inviteId = uuidv4();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry for org invites

      const inviteResult = await db.query(`
        INSERT INTO user_invites (
          id, inviter_user_id, email, invite_type, expires_at, sent_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING invite_code
      `, [inviteId, inviterUserId, email.toLowerCase(), 'organization_member', expiresAt]);

      const inviteCode = inviteResult.rows[0].invite_code;

      // Send organization member invitation email
      const organizationName = inviter.org_name || 'the organization';
      try {
        await emailService.sendOrganizationMemberInvitation(
          inviterUserId,
          email,
          organizationName,
          inviteCode
        );
        console.log(`✅ Organization invitation email sent to ${email}`);
      } catch (emailError) {
        console.error('❌ Failed to send organization invitation email:', emailError);
        // Don't throw - invitation was created, email failure shouldn't block the response
      }

      return {
        inviteId,
        inviteCode,
        inviterName: `${inviter.first_name} ${inviter.last_name}`,
        organizationName: inviter.org_name,
        email,
        role,
        expiresAt,
        inviteLink: `https://automatemyblog.com/signup?invite=${inviteCode}`
      };
    } catch (error) {
      console.error('Error sending organization invite:', error);
      throw error;
    }
  }

  /**
   * Get referral statistics for user
   */
  async getReferralStats(userId) {
    try {
      // Get basic referral info
      const userResult = await db.query(`
        SELECT referral_code, total_referrals_made, successful_referrals, 
               lifetime_referral_rewards_earned
        FROM users WHERE id = $1
      `, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];

      // Get detailed invite statistics
      const inviteStatsResult = await db.query(`
        SELECT 
          COUNT(*) as total_invites_sent,
          COUNT(CASE WHEN status = 'accepted' THEN 1 END) as total_accepted,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as total_pending,
          COUNT(CASE WHEN invite_type = 'referral' THEN 1 END) as referral_invites,
          COUNT(CASE WHEN invite_type = 'organization_member' THEN 1 END) as org_invites
        FROM user_invites 
        WHERE inviter_user_id = $1
      `, [userId]);

      const inviteStats = inviteStatsResult.rows[0];

      // Get reward statistics
      const rewardStatsResult = await db.query(`
        SELECT 
          COUNT(*) as total_rewards,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_rewards,
          COUNT(CASE WHEN status = 'used' THEN 1 END) as used_rewards,
          SUM(reward_value) as total_reward_value,
          SUM(CASE WHEN status = 'active' THEN reward_value ELSE 0 END) as available_reward_value
        FROM referral_rewards 
        WHERE user_id = $1
      `, [userId]);

      const rewardStats = rewardStatsResult.rows[0];

      // Get recent referral activity
      const recentActivityResult = await db.query(`
        SELECT 
          r.id,
          r.completed_at,
          r.conversion_value,
          u.email as referred_email,
          u.first_name,
          u.last_name
        FROM referrals r
        JOIN users u ON r.referred_user_id = u.id
        WHERE r.referrer_user_id = $1 AND r.status = 'completed'
        ORDER BY r.completed_at DESC
        LIMIT 10
      `, [userId]);

      return {
        referralCode: user.referral_code,
        totalReferralsMade: parseInt(user.total_referrals_made),
        successfulReferrals: parseInt(user.successful_referrals),
        lifetimeEarnings: parseFloat(user.lifetime_referral_rewards_earned),
        inviteStats: {
          totalSent: parseInt(inviteStatsResult.rows[0].total_invites_sent),
          totalAccepted: parseInt(inviteStatsResult.rows[0].total_accepted),
          totalPending: parseInt(inviteStatsResult.rows[0].total_pending),
          referralInvites: parseInt(inviteStatsResult.rows[0].referral_invites),
          organizationInvites: parseInt(inviteStatsResult.rows[0].org_invites)
        },
        rewardStats: {
          totalRewards: parseInt(rewardStats.total_rewards || 0),
          activeRewards: parseInt(rewardStats.active_rewards || 0),
          usedRewards: parseInt(rewardStats.used_rewards || 0),
          totalValue: parseFloat(rewardStats.total_reward_value || 0),
          availableValue: parseFloat(rewardStats.available_reward_value || 0)
        },
        recentActivity: recentActivityResult.rows
      };
    } catch (error) {
      console.error('Error getting referral stats:', error);
      throw error;
    }
  }

  /**
   * Process referral signup (when someone signs up with a referral code or invite code)
   */
  async processReferralSignup(newUserId, code) {
    console.log('🔄 Starting referral signup processing:', { newUserId, code });
    
    try {
      await db.transaction(async (client) => {
        let invite = null;
        let referrerUserId = null;
        
        console.log('🔍 Step 1: Checking for invite code in user_invites table...');
        
        // First, try to find it as an invite code
        const inviteResult = await client.query(`
          SELECT id, inviter_user_id, invite_type, status, expires_at
          FROM user_invites 
          WHERE invite_code = $1
        `, [code]);
        
        console.log('📊 Invite code lookup result:', {
          found: inviteResult.rows.length > 0,
          results: inviteResult.rows
        });
        
        if (inviteResult.rows.length > 0) {
          // Found an invite code
          console.log('✅ Found invite code, using invite flow');
          invite = inviteResult.rows[0];
          referrerUserId = invite.inviter_user_id;
        } else {
          console.log('🔍 Step 2: No invite found, checking for direct referral code in users table...');
          
          // Not an invite code, try as a direct referral code
          const referrerResult = await client.query(`
            SELECT id, email, first_name, last_name, referral_code FROM users WHERE referral_code = $1
          `, [code]);
          
          console.log('📊 Referral code lookup result:', {
            found: referrerResult.rows.length > 0,
            searchedCode: code,
            results: referrerResult.rows
          });
          
          if (referrerResult.rows.length > 0) {
            console.log('✅ Found referrer user, creating virtual invite record');
            referrerUserId = referrerResult.rows[0].id;
            
            // Create a virtual invite record for direct referrals
            const virtualInviteId = uuidv4();
            await client.query(`
              INSERT INTO user_invites (
                id, inviter_user_id, email, invite_type, invite_code, 
                status, expires_at, sent_at, accepted_at, accepted_by_user_id
              ) 
              SELECT $1, $2, u.email, 'referral', $3, 'accepted', 
                     NOW() + INTERVAL '30 days', NOW(), NOW(), $4
              FROM users u WHERE u.id = $4
            `, [virtualInviteId, referrerUserId, code, newUserId]);
            
            // Create the invite object for processing
            invite = {
              id: virtualInviteId,
              inviter_user_id: referrerUserId,
              invite_type: 'referral',
              status: 'accepted',
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            };
          }
        }

        if (!invite) {
          throw new Error('Invalid referral or invite code');
        }

        // For invite codes (not direct referrals), check if invite is still valid
        if (inviteResult.rows.length > 0) {
          if (invite.status !== 'pending') {
            throw new Error('Invite has already been used or cancelled');
          }

          if (new Date(invite.expires_at) < new Date()) {
            throw new Error('Invite has expired');
          }
        }

        // Mark invite as accepted (only if it was a real pending invite)
        if (inviteResult.rows.length > 0) {
          await client.query(`
            UPDATE user_invites 
            SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = $1
            WHERE id = $2
          `, [newUserId, invite.id]);
        }

        // If this is a referral (not organization invite), create referral record and rewards
        if (invite.invite_type === 'referral') {
          // Create referral record
          await client.query(`
            INSERT INTO referrals (
              id, referrer_user_id, referred_user_id, invite_id, 
              referral_code, status, completed_at
            ) VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
          `, [uuidv4(), invite.inviter_user_id, newUserId, invite.id, code]);

          // Create rewards for both referrer and referred user
          const rewardId1 = uuidv4();
          const rewardId2 = uuidv4();

          // Get referrer email for description
          const referrerInfoResult = await client.query(`
            SELECT email FROM users WHERE id = $1
          `, [invite.inviter_user_id]);

          const referrerEmail = referrerInfoResult.rows[0]?.email || 'Unknown';

          // Get new user email for description
          const newUserInfoResult = await client.query(`
            SELECT email FROM users WHERE id = $1
          `, [newUserId]);

          const newUserEmail = newUserInfoResult.rows[0]?.email || 'Unknown';

          // Reward for referrer
          await client.query(`
            INSERT INTO referral_rewards (
              id, user_id, earned_from_invite_id, reward_type, reward_value,
              status, granted_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())
          `, [rewardId1, invite.inviter_user_id, invite.id, 'free_generation', this.rewardValues.free_generation]);

          // Create user_credit for referrer
          await client.query(`
            INSERT INTO user_credits (
              user_id,
              source_type,
              source_id,
              source_description,
              quantity,
              value_usd,
              status,
              priority,
              created_at
            ) VALUES (
              $1, 'referral', $2, $3, 1, $4, 'active', 75, NOW()
            )
          `, [
            invite.inviter_user_id,
            rewardId1,
            `Referral reward from ${newUserEmail}`,
            this.rewardValues.free_generation
          ]);

          // Reward for new user
          await client.query(`
            INSERT INTO referral_rewards (
              id, user_id, earned_from_invite_id, reward_type, reward_value,
              status, granted_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', NOW())
          `, [rewardId2, newUserId, invite.id, 'free_generation', this.rewardValues.free_generation]);

          // Create user_credit for new user
          await client.query(`
            INSERT INTO user_credits (
              user_id,
              source_type,
              source_id,
              source_description,
              quantity,
              value_usd,
              status,
              priority,
              created_at
            ) VALUES (
              $1, 'referral', $2, $3, 1, $4, 'active', 75, NOW()
            )
          `, [
            newUserId,
            rewardId2,
            `Welcome bonus from referral by ${referrerEmail}`,
            this.rewardValues.free_generation
          ]);

          console.log(`✅ Created referral credits for referrer ${invite.inviter_user_id} and new user ${newUserId}`);

          // Update referrer's stats
          await client.query(`
            UPDATE users
            SET successful_referrals = successful_referrals + 1,
                lifetime_referral_rewards_earned = lifetime_referral_rewards_earned + $2
            WHERE id = $1
          `, [invite.inviter_user_id, this.rewardValues.free_generation]);

          // Send referral notification emails (async, don't block transaction)
          // These are fire-and-forget to avoid blocking the signup flow
          emailService.sendReferralAcceptedNotification(invite.inviter_user_id, newUserEmail)
            .then(() => console.log(`✅ Referral accepted notification sent to referrer ${invite.inviter_user_id}`))
            .catch(err => console.error('❌ Failed to send referral accepted notification:', err));

          emailService.sendReferralRewardGranted(invite.inviter_user_id, 'free_generation', this.rewardValues.free_generation)
            .then(() => console.log(`✅ Referral reward notification sent to referrer ${invite.inviter_user_id}`))
            .catch(err => console.error('❌ Failed to send referral reward notification to referrer:', err));

          emailService.sendReferralRewardGranted(newUserId, 'free_generation', this.rewardValues.free_generation)
            .then(() => console.log(`✅ Referral reward notification sent to new user ${newUserId}`))
            .catch(err => console.error('❌ Failed to send referral reward notification to new user:', err));

          // Mark invite as rewarded
          await client.query(`
            UPDATE user_invites 
            SET reward_granted_to_inviter = TRUE, reward_granted_to_invitee = TRUE
            WHERE id = $1
          `, [invite.id]);

          return {
            type: 'referral',
            rewardGranted: true,
            rewardValue: this.rewardValues.free_generation
          };
        } else if (invite.invite_type === 'organization_member') {
          // Add user to the inviter's organization
          const inviterOrgResult = await client.query(`
            SELECT organization_id FROM organization_members 
            WHERE user_id = $1 LIMIT 1
          `, [invite.inviter_user_id]);

          if (inviterOrgResult.rows.length > 0) {
            await client.query(`
              INSERT INTO organization_members (
                id, organization_id, user_id, role, joined_at, status
              ) VALUES ($1, $2, $3, $4, NOW(), 'active')
            `, [uuidv4(), inviterOrgResult.rows[0].organization_id, newUserId, 'member']);
          }

          return {
            type: 'organization_member',
            rewardGranted: false
          };
        }
      });
    } catch (error) {
      console.error('Error processing referral signup:', error);
      throw error;
    }
  }

  /**
   * Get organization members for management
   */
  async getOrganizationMembers(userId) {
    try {
      // First get user's organization
      const orgResult = await db.query(`
        SELECT om.organization_id, o.name, om.role
        FROM organization_members om
        JOIN organizations o ON om.organization_id = o.id
        WHERE om.user_id = $1
      `, [userId]);

      if (orgResult.rows.length === 0) {
        throw new Error('User is not part of any organization');
      }

      const organization = orgResult.rows[0];

      // Check if user has admin rights
      if (!['owner', 'admin'].includes(organization.role)) {
        throw new Error('Insufficient permissions to view organization members');
      }

      // Get all organization members
      const membersResult = await db.query(`
        SELECT 
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          om.role,
          om.joined_at,
          om.status,
          u.last_login_at
        FROM organization_members om
        JOIN users u ON om.user_id = u.id
        WHERE om.organization_id = $1
        ORDER BY om.joined_at ASC
      `, [organization.organization_id]);

      return {
        organization: {
          id: organization.organization_id,
          name: organization.name,
          userRole: organization.role
        },
        members: membersResult.rows
      };
    } catch (error) {
      console.error('Error getting organization members:', error);
      throw error;
    }
  }

  /**
   * Remove organization member
   */
  async removeOrganizationMember(adminUserId, memberUserId) {
    try {
      // Get admin's organization and check permissions
      const adminResult = await db.query(`
        SELECT om.organization_id, om.role
        FROM organization_members om
        WHERE om.user_id = $1
      `, [adminUserId]);

      if (adminResult.rows.length === 0) {
        throw new Error('Admin user is not part of any organization');
      }

      const admin = adminResult.rows[0];

      if (!['owner', 'admin'].includes(admin.role)) {
        throw new Error('Insufficient permissions to remove members');
      }

      // Cannot remove owner
      const memberResult = await db.query(`
        SELECT role FROM organization_members 
        WHERE user_id = $1 AND organization_id = $2
      `, [memberUserId, admin.organization_id]);

      if (memberResult.rows.length === 0) {
        throw new Error('Member not found in organization');
      }

      if (memberResult.rows[0].role === 'owner') {
        throw new Error('Cannot remove organization owner');
      }

      // Remove the member
      await db.query(`
        DELETE FROM organization_members 
        WHERE user_id = $1 AND organization_id = $2
      `, [memberUserId, admin.organization_id]);

      return { success: true };
    } catch (error) {
      console.error('Error removing organization member:', error);
      throw error;
    }
  }
}

export default new ReferralService();