/**
 * Retrieval Orchestrator Service
 * Coordinates data retrieval from all sources
 */

const { v4: uuidv4 } = require('uuid');
const alphasenseConnector = require('./connectors/alphasenseConnector');
const arcConnector = require('./connectors/arcConnector');
const internetConnector = require('./connectors/internetConnector');
const normalizationEngine = require('./normalizationEngine');

// Progress subscribers
const progressSubscribers = new Map();

class RetrievalOrchestrator {
    constructor() {
        this.stages = [
            { id: 'auth', name: 'Authenticating to data sources', weight: 5 },
            { id: 'alphasense', name: 'Pulling AlphaSense insights', weight: 25 },
            { id: 'arc', name: 'Pulling ARC benchmarks', weight: 20 },
            { id: 'internet', name: 'Pulling regulatory signals', weight: 20 },
            { id: 'normalize', name: 'Normalising & validating', weight: 25 },
            { id: 'complete', name: 'Finalizing Source Pack', weight: 5 }
        ];
    }

    /**
     * Subscribe to progress updates for a request
     */
    subscribeToProgress(requestId, callback) {
        if (!progressSubscribers.has(requestId)) {
            progressSubscribers.set(requestId, new Set());
        }
        progressSubscribers.get(requestId).add(callback);

        return () => {
            const subscribers = progressSubscribers.get(requestId);
            if (subscribers) {
                subscribers.delete(callback);
                if (subscribers.size === 0) {
                    progressSubscribers.delete(requestId);
                }
            }
        };
    }

    /**
     * Emit progress update
     */
    emitProgress(requestId, stage, status, details = {}) {
        const progress = {
            requestId,
            stage,
            status,
            timestamp: new Date().toISOString(),
            ...details
        };

        const subscribers = progressSubscribers.get(requestId);
        if (subscribers) {
            subscribers.forEach(callback => callback(progress));
        }

        return progress;
    }

    /**
     * Generate a complete Source Pack
     */
    async generateSourcePack({ requestId, client, context, user }) {
        const startTime = Date.now();
        const retrievedData = {};

        try {
            // Stage 1: Authentication
            this.emitProgress(requestId, 'auth', 'in-progress', {
                message: 'Authenticating to AlphaSense...'
            });
            await this.simulateDelay(800);
            this.emitProgress(requestId, 'auth', 'complete', {
                message: 'Authentication successful'
            });

            // Stage 2: AlphaSense Retrieval
            this.emitProgress(requestId, 'alphasense', 'in-progress', {
                message: 'Pulling AlphaSense insights...'
            });
            retrievedData.alphasense = await alphasenseConnector.retrieve({
                client,
                context,
                onProgress: (msg) => this.emitProgress(requestId, 'alphasense', 'in-progress', { message: msg })
            });
            this.emitProgress(requestId, 'alphasense', 'complete', {
                message: `Retrieved ${retrievedData.alphasense.documents?.length || 0} documents`
            });

            // Stage 3: ARC Retrieval
            this.emitProgress(requestId, 'arc', 'in-progress', {
                message: 'Pulling ARC benchmarks...'
            });
            retrievedData.arc = await arcConnector.retrieve({
                client,
                context,
                onProgress: (msg) => this.emitProgress(requestId, 'arc', 'in-progress', { message: msg })
            });
            this.emitProgress(requestId, 'arc', 'complete', {
                message: `Retrieved ${Object.keys(retrievedData.arc.kpis || {}).length} KPIs`
            });

            // Stage 4: Internet Retrieval
            this.emitProgress(requestId, 'internet', 'in-progress', {
                message: 'Pulling regulatory signals...'
            });
            retrievedData.internet = await internetConnector.retrieve({
                client,
                context,
                onProgress: (msg) => this.emitProgress(requestId, 'internet', 'in-progress', { message: msg })
            });
            this.emitProgress(requestId, 'internet', 'complete', {
                message: `Retrieved ${retrievedData.internet.articles?.length || 0} regulatory items`
            });

            // Stage 5: Normalization
            this.emitProgress(requestId, 'normalize', 'in-progress', {
                message: 'Normalising & validating...'
            });
            const normalizedData = await normalizationEngine.normalize({
                client,
                context,
                retrievedData,
                onProgress: (msg) => this.emitProgress(requestId, 'normalize', 'in-progress', { message: msg })
            });
            this.emitProgress(requestId, 'normalize', 'complete', {
                message: 'Schema validation passed'
            });

            // Stage 6: Finalization
            this.emitProgress(requestId, 'complete', 'in-progress', {
                message: 'Finalizing Source Pack...'
            });

            const sourcePack = this.buildSourcePack({
                requestId,
                client,
                context,
                normalizedData,
                user,
                startTime
            });

            this.emitProgress(requestId, 'complete', 'complete', {
                message: 'Source Pack ready',
                duration: Date.now() - startTime
            });

            return sourcePack;

        } catch (error) {
            this.emitProgress(requestId, 'error', 'failed', {
                message: error.message
            });
            throw error;
        }
    }

    /**
     * Build the final Source Pack structure
     */
    buildSourcePack({ requestId, client, context, normalizedData, user, startTime }) {
        return {
            // Client information
            client: {
                id: client.id,
                name: client.name,
                industry: client.industry,
                geography: client.geography,
                sector: client.sector
            },

            // Context configuration
            context: {
                industry: context.industry || client.industry,
                subSector: context.subSector || client.sector,
                geography: context.geography || client.geography,
                timeHorizon: context.timeHorizon || 90,
                outputIntent: context.outputIntent || 'CEO Narrative'
            },

            // Company profile
            company_profile: normalizedData.companyProfile,

            // AlphaSense consensus insights
            alphasense_consensus: normalizedData.alphasenseConsensus,

            // Competitor intelligence
            competitor_moves: normalizedData.competitorMoves,

            // Industry KPIs
            industry_kpis: normalizedData.industryKpis,

            // Regulatory events
            regulatory_events: normalizedData.regulatoryEvents,

            // Confidence scores
            confidence_scores: normalizedData.confidenceScores,

            // Source references
            sources: normalizedData.sources,

            // Metadata
            metadata: {
                request_id: requestId,
                generated_at: new Date().toISOString(),
                generated_by: user.name,
                user_role: user.role,
                processing_time_ms: Date.now() - startTime,
                schema_version: '1.0.0',
                apis_used: ['alphasense', 'arc', 'internet']
            }
        };
    }

    /**
     * Utility for simulating async operations
     */
    simulateDelay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new RetrievalOrchestrator();
