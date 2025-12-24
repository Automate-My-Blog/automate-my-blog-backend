import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

// In-memory user storage (replace with database in production)
const users = new Map();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-development';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

class AuthService {
  // Register a new user
  async register(userData) {
    const { email, password, firstName, lastName, organizationName } = userData;

    // Check if user already exists
    const existingUser = Array.from(users.values()).find(user => user.email === email);
    if (existingUser) {
      throw new Error('User already exists with this email');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = {
      id: uuidv4(),
      email,
      firstName,
      lastName,
      organizationName,
      hashedPassword,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store user
    users.set(user.id, user);

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Return user without password
    const { hashedPassword: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      ...tokens
    };
  }

  // Login user
  async login(email, password) {
    // Find user by email
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.hashedPassword);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Return user without password
    const { hashedPassword: _, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      ...tokens
    };
  }

  // Generate JWT tokens
  generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationName: user.organizationName
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { 
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'autoblog-api'
    });

    const refreshToken = jwt.sign(
      { userId: user.id }, 
      JWT_SECRET, 
      { 
        expiresIn: '30d',
        issuer: 'autoblog-api'
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN
    };
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  // Get user by ID
  getUserById(userId) {
    const user = users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const { hashedPassword: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // Refresh tokens
  async refreshTokens(refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET);
      const user = users.get(decoded.userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Middleware to protect routes
  authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      const decoded = this.verifyToken(token);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({
        error: 'Access denied',
        message: error.message
      });
    }
  }

  // Optional auth middleware (allows both authenticated and non-authenticated requests)
  optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = this.verifyToken(token);
        req.user = decoded;
      } catch (error) {
        // Ignore invalid tokens for optional auth
      }
    }
    
    next();
  }

  // Get all users (admin only - for debugging)
  getAllUsers() {
    return Array.from(users.values()).map(user => {
      const { hashedPassword: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
  }
}

// Export singleton instance
const authService = new AuthService();
export default authService;