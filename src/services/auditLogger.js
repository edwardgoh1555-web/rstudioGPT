/**
 * Audit Logger Service
 * Comprehensive logging for governance and compliance
 */

const { v4: uuidv4 } = require('uuid');

class AuditLogger {
    constructor() {
        // In-memory log store (in production, use database or log aggregator)
        this.logs = [];
        this.maxLogs = 10000;
    }

    /**
     * Log an audit event
     */
    log(category, action, details = {}) {
        const entry = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            category,
            action,
            details,
            environment: process.env.NODE_ENV || 'development'
        };

        this.logs.unshift(entry);

        // Trim old logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(0, this.maxLogs);
        }

        // Console output for development
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[AUDIT] ${category}::${action}`, JSON.stringify(details));
        }

        return entry;
    }

    /**
     * Log authentication events
     */
    logAuth(action, details) {
        return this.log('AUTH', action, {
            ...details,
            ip: details.ip || 'unknown',
            userAgent: details.userAgent || 'unknown'
        });
    }

    /**
     * Log API retrieval events
     */
    logRetrieval(action, details) {
        return this.log('RETRIEVAL', action, {
            ...details,
            apis: details.apis || [],
            queryParameters: this.sanitizeQueryParams(details.queryParameters)
        });
    }

    /**
     * Log configuration changes
     */
    logConfig(action, details) {
        return this.log('CONFIG', action, {
            ...details,
            // Never log actual credential values
            credentialsUpdated: details.provider ? true : false
        });
    }

    /**
     * Log export events
     */
    logExport(action, details) {
        return this.log('EXPORT', action, {
            ...details,
            format: details.format,
            sourcePackId: details.sourcePackId
        });
    }

    /**
     * Log validation events
     */
    logValidation(action, details) {
        return this.log('VALIDATION', action, {
            ...details,
            status: details.status,
            issueCount: details.issueCount
        });
    }

    /**
     * Log errors
     */
    logError(action, error, details = {}) {
        return this.log('ERROR', action, {
            ...details,
            errorMessage: error.message || error,
            errorStack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
        });
    }

    /**
     * Sanitize query parameters to avoid logging sensitive data
     */
    sanitizeQueryParams(params) {
        if (!params) return {};
        
        const sanitized = { ...params };
        const sensitiveFields = ['password', 'token', 'key', 'secret', 'authorization'];
        
        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }
        
        return sanitized;
    }

    /**
     * Get logs with filtering
     */
    getLogs(options = {}) {
        let filtered = [...this.logs];

        if (options.category) {
            filtered = filtered.filter(log => log.category === options.category);
        }

        if (options.action) {
            filtered = filtered.filter(log => log.action === options.action);
        }

        if (options.startDate) {
            const start = new Date(options.startDate);
            filtered = filtered.filter(log => new Date(log.timestamp) >= start);
        }

        if (options.endDate) {
            const end = new Date(options.endDate);
            filtered = filtered.filter(log => new Date(log.timestamp) <= end);
        }

        if (options.user) {
            filtered = filtered.filter(log => 
                log.details?.user === options.user || 
                log.details?.username === options.user
            );
        }

        if (options.limit) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * Get log statistics
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            byCategory: {},
            byAction: {},
            last24Hours: 0,
            last7Days: 0
        };

        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        for (const log of this.logs) {
            // By category
            stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
            
            // By action
            const key = `${log.category}::${log.action}`;
            stats.byAction[key] = (stats.byAction[key] || 0) + 1;

            // Time-based
            const logDate = new Date(log.timestamp);
            if (logDate >= oneDayAgo) stats.last24Hours++;
            if (logDate >= oneWeekAgo) stats.last7Days++;
        }

        return stats;
    }

    /**
     * Export logs for compliance
     */
    exportLogs(options = {}) {
        const logs = this.getLogs(options);
        
        return {
            exported_at: new Date().toISOString(),
            count: logs.length,
            filters: options,
            logs
        };
    }

    /**
     * Clear logs (admin only, with audit trail)
     */
    clearLogs(clearedBy) {
        const count = this.logs.length;
        
        // Log the clear action first
        this.log('ADMIN', 'LOGS_CLEARED', {
            clearedBy,
            logCount: count,
            timestamp: new Date().toISOString()
        });

        // Keep only the clear log
        this.logs = this.logs.slice(0, 1);

        return { cleared: count - 1 };
    }
}

module.exports = new AuditLogger();
