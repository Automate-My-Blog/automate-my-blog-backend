# Superadmin Management Guide

## Overview

The AutomateMyBlog platform uses an environment-based superadmin promotion system that automatically grants superadmin privileges to specified email addresses.

## How It Works

### Automatic Role Promotion

When a user with an email address listed in the `SUPER_ADMIN_EMAILS` environment variable logs in, the system automatically:

1. Detects their email matches the superadmin list
2. Promotes their role to `super_admin` (hierarchy level 100)
3. Grants full superadmin permissions
4. Logs the promotion to the audit trail

This happens during authentication in `services/auth-database.js:519-548`.

### Role Hierarchy

| Role | Hierarchy Level | Key Permissions |
|------|-----------------|-----------------|
| `user` | 10 | Basic content creation and management |
| `admin` | 50 | Team management, billing, organization settings |
| `super_admin` | 100 | Full platform access: user management, platform analytics, feature flags, audit logs, system settings |

## Adding a New Superadmin

### For Development Environment

1. Update `backend/.env`:
```bash
SUPER_ADMIN_EMAILS="existing@example.com,newemail@example.com"
```

2. Restart the backend server

3. Have the user register or log in - they will be automatically promoted

### For Production (Vercel)

#### Option 1: Via Vercel Dashboard

1. Go to your Vercel project settings
2. Navigate to **Environment Variables**
3. Find `SUPER_ADMIN_EMAILS`
4. Update the value to include the new email:
   ```
   existing@example.com,newemail@example.com
   ```
5. Redeploy the application for changes to take effect

#### Option 2: Via Vercel CLI

```bash
# Add or update the environment variable
vercel env add SUPER_ADMIN_EMAILS production

# When prompted, enter the comma-separated list of emails:
# existing@example.com,newemail@example.com

# Redeploy
vercel --prod
```

### User Registration

Once the environment variable is updated:

1. **If user doesn't have an account:**
   - They register via the normal registration endpoint
   - On first login, automatic promotion occurs

2. **If user already has an account:**
   - They simply log in
   - System detects their email and promotes them automatically

## Superadmin Permissions

Superadmins have access to:

- **User Management**: View all users, manage user accounts
- **Platform Analytics**: View system-wide analytics and metrics
- **Feature Flags**: Enable/disable features for testing
- **Audit Logs**: View security and activity logs
- **System Settings**: Configure platform-wide settings
- **All Organization Access**: Can view and manage any organization

## Security Considerations

1. **Environment Variable Security**: Keep production `.env` files secure and never commit them to version control
2. **Email Verification**: Ensure superadmin emails are verified and trusted
3. **Audit Logging**: All role promotions are automatically logged
4. **Minimal Access**: Only grant superadmin access to trusted team members
5. **Regular Review**: Periodically audit the superadmin list

## Current Superadmins

As of 2026-02-04:

**Development:**
- james@frankel.tv
- james@automatemyblog.com
- samuhill@gmail.com

**Production:**
- james@frankel.tv
- samuhill@gmail.com

## Removing Superadmin Access

To revoke superadmin access:

1. Remove the email from `SUPER_ADMIN_EMAILS` environment variable
2. Redeploy the application
3. Optionally, manually update the user's role in the database:
   ```sql
   UPDATE users
   SET role = 'admin', updated_at = NOW()
   WHERE email = 'user@example.com';
   ```

## Verification

To verify a user has superadmin access:

1. **Via Database:**
   ```sql
   SELECT id, email, role, hierarchy_level
   FROM users u
   LEFT JOIN user_roles ur ON u.role = ur.name
   WHERE email = 'user@example.com';
   ```

2. **Via API:** Call `/api/v1/auth/me` with the user's JWT token
   ```json
   {
     "role": "super_admin",
     "permissions": [...],
     "hierarchyLevel": 100
   }
   ```

## Troubleshooting

### User Not Promoted After Login

1. Verify the email is correctly added to `SUPER_ADMIN_EMAILS`
2. Check for typos or extra spaces in the email list
3. Ensure the application was redeployed after the environment variable change
4. Check application logs for promotion messages: `🛡️ Auto-promoting {email} to super_admin role`

### Multiple Environments Out of Sync

Always update all environment files:
- `.env.example` (template for documentation)
- `.env` (local development)
- `.env.production` (production reference)
- Vercel environment variables (actual production)

## Related Files

- **Auto-promotion Logic**: `backend/services/auth-database.js:519-548`
- **Role Definitions**: `backend/database/04_admin_security_tables.sql`
- **User Schema**: `backend/database/01_core_tables.sql`
- **Middleware**: Superadmin routes use `requireSuperAdmin` middleware

## References

- User Roles Table: `user_roles`
- Users Table: `users`
- Audit Logs: `user_activity_events`
- Database Function: `user_has_permission(user_id, permission)`
