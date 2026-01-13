/**
 * Authentication Middleware
 * Role-based access control
 */

class AuthMiddleware {
    /**
     * Require authenticated user
     */
    requireAuth(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }
        next();
    }

    /**
     * Require admin role
     */
    requireAdmin(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        if (req.session.user.role !== 'admin') {
            return res.status(403).json({
                error: 'Admin access required',
                code: 'ADMIN_REQUIRED'
            });
        }
        next();
    }

    /**
     * Require specific roles
     */
    requireRoles(...roles) {
        return (req, res, next) => {
            if (!req.session.user) {
                return res.status(401).json({
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            if (!roles.includes(req.session.user.role)) {
                return res.status(403).json({
                    error: `One of the following roles required: ${roles.join(', ')}`,
                    code: 'ROLE_REQUIRED'
                });
            }
            next();
        };
    }

    /**
     * Check if user has permission for client
     */
    requireClientAccess(req, res, next) {
        if (!req.session.user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // In production, check if user has access to specific client
        // For demo, allow all authenticated users
        const clientId = req.params.clientId || req.body.clientId;
        
        // Placeholder for client-level access control
        // const hasAccess = checkClientAccess(req.session.user, clientId);
        
        next();
    }
}

module.exports = new AuthMiddleware();
