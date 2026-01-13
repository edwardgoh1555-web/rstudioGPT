/**
 * Schema Validator Service
 * Validates Source Packs against canonical schema
 */

class SchemaValidator {
    constructor() {
        this.requiredFields = [
            'client',
            'context',
            'company_profile',
            'alphasense_consensus',
            'competitor_moves',
            'industry_kpis',
            'regulatory_events',
            'confidence_scores',
            'sources',
            'metadata'
        ];

        this.minimumThresholds = {
            confidence_overall: 50,
            sources_count: 3,
            themes_count: 1
        };
    }

    /**
     * Validate a Source Pack
     */
    validate(sourcePack) {
        const issues = [];
        const warnings = [];
        
        // Check required fields
        const missingFields = this.checkRequiredFields(sourcePack);
        issues.push(...missingFields);

        // Check completeness
        const completenessIssues = this.checkCompleteness(sourcePack);
        warnings.push(...completenessIssues);

        // Check quality
        const qualityIssues = this.checkQuality(sourcePack);
        warnings.push(...qualityIssues);

        // Check confidence thresholds
        const confidenceIssues = this.checkConfidence(sourcePack);
        warnings.push(...confidenceIssues);

        // Determine overall status
        const status = this.determineStatus(issues, warnings);

        return {
            status: status.code,
            statusLabel: status.label,
            statusDescription: status.description,
            valid: issues.length === 0,
            issues,
            warnings,
            checks: {
                requiredFields: missingFields.length === 0,
                completeness: completenessIssues.length === 0,
                quality: qualityIssues.length === 0,
                confidence: confidenceIssues.length === 0
            },
            summary: this.generateSummary(sourcePack, issues, warnings)
        };
    }

    /**
     * Check required fields are present
     */
    checkRequiredFields(sourcePack) {
        const missing = [];
        
        for (const field of this.requiredFields) {
            if (!sourcePack[field]) {
                missing.push({
                    type: 'missing_field',
                    field,
                    severity: 'error',
                    message: `Required field '${field}' is missing`
                });
            }
        }

        return missing;
    }

    /**
     * Check data completeness
     */
    checkCompleteness(sourcePack) {
        const issues = [];

        // Check sources count
        if (!sourcePack.sources || sourcePack.sources.length < this.minimumThresholds.sources_count) {
            issues.push({
                type: 'incomplete_data',
                field: 'sources',
                severity: 'warning',
                message: `Fewer than ${this.minimumThresholds.sources_count} sources available`
            });
        }

        // Check themes count
        const themesCount = sourcePack.alphasense_consensus?.themes?.length || 0;
        if (themesCount < this.minimumThresholds.themes_count) {
            issues.push({
                type: 'incomplete_data',
                field: 'alphasense_consensus.themes',
                severity: 'warning',
                message: 'Limited analyst themes available'
            });
        }

        // Check competitor moves
        if (!sourcePack.competitor_moves || sourcePack.competitor_moves.length === 0) {
            issues.push({
                type: 'incomplete_data',
                field: 'competitor_moves',
                severity: 'warning',
                message: 'No competitor intelligence available'
            });
        }

        // Check regulatory events
        if (!sourcePack.regulatory_events || sourcePack.regulatory_events.length === 0) {
            issues.push({
                type: 'incomplete_data',
                field: 'regulatory_events',
                severity: 'warning',
                message: 'No regulatory events captured'
            });
        }

        // Check KPIs
        const kpiCount = Object.keys(sourcePack.industry_kpis || {}).length;
        if (kpiCount === 0) {
            issues.push({
                type: 'incomplete_data',
                field: 'industry_kpis',
                severity: 'warning',
                message: 'No industry KPIs available'
            });
        }

        return issues;
    }

    /**
     * Check data quality
     */
    checkQuality(sourcePack) {
        const issues = [];

        // Check for stale data
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 180);

        if (sourcePack.sources) {
            const staleCount = sourcePack.sources.filter(s => {
                const sourceDate = new Date(s.date);
                return sourceDate < cutoffDate;
            }).length;

            if (staleCount > sourcePack.sources.length * 0.5) {
                issues.push({
                    type: 'stale_data',
                    severity: 'warning',
                    message: 'More than 50% of sources are older than 180 days'
                });
            }
        }

        // Check sentiment data quality
        if (sourcePack.alphasense_consensus?.sentiment) {
            const sentiment = sourcePack.alphasense_consensus.sentiment;
            if (!sentiment.overall || sentiment.score === undefined) {
                issues.push({
                    type: 'quality_issue',
                    field: 'alphasense_consensus.sentiment',
                    severity: 'warning',
                    message: 'Incomplete sentiment data'
                });
            }
        }

        // Check for conflicting signals
        if (sourcePack.alphasense_consensus?.divergent_views?.length > 2) {
            issues.push({
                type: 'conflicting_signals',
                severity: 'info',
                message: 'Multiple divergent analyst views detected - human review recommended'
            });
        }

        return issues;
    }

    /**
     * Check confidence thresholds
     */
    checkConfidence(sourcePack) {
        const issues = [];

        if (sourcePack.confidence_scores) {
            const { overall, data_completeness, source_quality } = sourcePack.confidence_scores;

            if (overall < this.minimumThresholds.confidence_overall) {
                issues.push({
                    type: 'low_confidence',
                    field: 'confidence_scores.overall',
                    severity: 'warning',
                    message: `Overall confidence (${overall}%) is below threshold (${this.minimumThresholds.confidence_overall}%)`
                });
            }

            if (data_completeness < 60) {
                issues.push({
                    type: 'low_confidence',
                    field: 'confidence_scores.data_completeness',
                    severity: 'warning',
                    message: `Data completeness (${data_completeness}%) is low`
                });
            }

            if (source_quality < 70) {
                issues.push({
                    type: 'low_confidence',
                    field: 'confidence_scores.source_quality',
                    severity: 'warning',
                    message: `Source quality score (${source_quality}%) is below expectations`
                });
            }
        }

        return issues;
    }

    /**
     * Determine overall validation status
     */
    determineStatus(issues, warnings) {
        if (issues.length > 0) {
            return {
                code: 'incomplete',
                label: '❌ Incomplete',
                description: 'Source Pack has blocking issues that must be resolved'
            };
        }

        const highSeverityWarnings = warnings.filter(w => 
            w.severity === 'warning' && 
            ['low_confidence', 'stale_data', 'conflicting_signals'].includes(w.type)
        );

        if (highSeverityWarnings.length > 0) {
            return {
                code: 'ready_with_caveats',
                label: '⚠️ Ready with Caveats',
                description: 'Source Pack is usable but has quality warnings'
            };
        }

        return {
            code: 'ready',
            label: '✅ Ready',
            description: 'Source Pack passes all validation checks'
        };
    }

    /**
     * Generate validation summary
     */
    generateSummary(sourcePack, issues, warnings) {
        const sourceCount = sourcePack.sources?.length || 0;
        const themeCount = sourcePack.alphasense_consensus?.themes?.length || 0;
        const kpiCount = Object.keys(sourcePack.industry_kpis || {}).length;
        const regulatoryCount = sourcePack.regulatory_events?.length || 0;

        return {
            totalSources: sourceCount,
            totalThemes: themeCount,
            totalKPIs: kpiCount,
            totalRegulatoryEvents: regulatoryCount,
            overallConfidence: sourcePack.confidence_scores?.overall || 0,
            issueCount: issues.length,
            warningCount: warnings.length,
            processingTime: sourcePack.metadata?.processing_time_ms || 0
        };
    }

    /**
     * Get canonical schema definition
     */
    getSchemaDefinition() {
        return {
            version: '1.0.0',
            fields: {
                client: {
                    type: 'object',
                    required: true,
                    fields: ['id', 'name', 'industry', 'geography', 'sector']
                },
                context: {
                    type: 'object',
                    required: true,
                    fields: ['industry', 'geography', 'timeHorizon', 'outputIntent']
                },
                company_profile: {
                    type: 'object',
                    required: true,
                    fields: ['name', 'industry', 'executive_summary', 'strategic_priorities']
                },
                alphasense_consensus: {
                    type: 'object',
                    required: true,
                    fields: ['themes', 'key_quotes', 'sentiment']
                },
                competitor_moves: {
                    type: 'array',
                    required: true,
                    itemFields: ['competitor', 'move', 'impact', 'source']
                },
                industry_kpis: {
                    type: 'object',
                    required: true
                },
                regulatory_events: {
                    type: 'array',
                    required: true,
                    itemFields: ['title', 'regulator', 'impact', 'status']
                },
                confidence_scores: {
                    type: 'object',
                    required: true,
                    fields: ['overall', 'data_completeness', 'source_quality', 'timeliness']
                },
                sources: {
                    type: 'array',
                    required: true,
                    itemFields: ['name', 'type', 'source', 'date']
                },
                metadata: {
                    type: 'object',
                    required: true,
                    fields: ['request_id', 'generated_at', 'generated_by', 'schema_version']
                }
            }
        };
    }
}

module.exports = new SchemaValidator();
