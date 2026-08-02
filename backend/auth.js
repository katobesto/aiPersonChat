import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'ai-chat-secret-key-change-me-in-production';
const TOKEN_EXPIRES_IN = '7d'; // 7 days

/**
 * Hash a password using scrypt.
 */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

/**
 * Verify a password against a stored hash.
 */
export function verifyPassword(plain, stored) {
  const [salt, expectedHex] = stored.split(':');
  const derived = crypto.scryptSync(plain, salt, 64);
  return derived.toString('hex') === expectedHex;
}

/**
 * Create a JWT token for a user.
 */
export function createToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

/**
 * Verify and decode a JWT token. Returns null if invalid.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Express middleware: extract Bearer token → req.user or 401.
 */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'No token provided' });
  const decoded = verifyToken(match[1]);
  if (!decoded) return res.status(403).json({ error: 'Invalid or expired token' });
  req.user = decoded;
  next();
}

/**
 * Express middleware: require admin role.
 */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
