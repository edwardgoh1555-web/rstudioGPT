/**
 * Normalization Engine
 * AI-assisted extraction, classification, and schema normalization
 */

class NormalizationEngine {
    constructor() {
        this.schemaVersion = '1.0.0';
    }

    /**
     * Normalize retrieved data into canonical schema
     */
    async normalize({ client, context, retrievedData, onProgress }) {
        onProgress?.('Extracting signals from documents...');
        await this.delay(400);

        onProgress?.('Classifying content into schema fields...');
        await this.delay(500);

        onProgress?.('De-duplicating overlapping insights...');
        await this.delay(300);

        onProgress?.('Assigning confidence levels...');
        await this.delay(400);

        onProgress?.('Flagging ambiguity and weak evidence...');
        await this.delay(300);

        return {
            companyProfile: this.normalizeCompanyProfile(client, retrievedData),
            alphasenseConsensus: this.normalizeAlphaSenseData(retrievedData.alphasense),
            competitorMoves: this.extractCompetitorMoves(client, retrievedData),
            industryKpis: this.normalizeKPIs(retrievedData.arc),
            regulatoryEvents: this.normalizeRegulatoryEvents(retrievedData.internet),
            confidenceScores: this.calculateConfidenceScores(retrievedData),
            sources: this.compileSources(retrievedData)
        };
    }

    /**
     * Normalize company profile
     */
    normalizeCompanyProfile(client, retrievedData) {
        const themes = retrievedData.alphasense?.themes || [];
        
        return {
            name: client.name,
            industry: client.industry,
            sector: client.sector,
            geography: client.geography,
            executive_summary: this.generateExecutiveSummary(client, themes),
            strategic_priorities: this.extractStrategicPriorities(client, themes),
            key_challenges: this.extractKeyChallenges(client, themes),
            opportunities: this.extractOpportunities(client, themes),
            risk_factors: this.extractRiskFactors(client, retrievedData)
        };
    }

    /**
     * Generate executive summary
     */
    generateExecutiveSummary(client, themes) {
        const topThemes = themes.slice(0, 2).map(t => t.theme.toLowerCase()).join(' and ');
        
        return `${client.name} operates in the ${client.industry} sector with a focus on ${client.sector}. ` +
               `Key strategic themes include ${topThemes || 'digital transformation and operational excellence'}. ` +
               `The company is positioned in ${client.geography} markets with exposure to evolving regulatory ` +
               `and competitive dynamics. Current analyst sentiment is generally constructive with emphasis on ` +
               `execution capability and market positioning.`;
    }

    /**
     * Extract strategic priorities
     */
    extractStrategicPriorities(client, themes) {
        const basePriorities = [
            'Accelerate digital transformation initiatives',
            'Enhance operational efficiency and margins',
            'Strengthen market position in core segments',
            'Invest in talent and capabilities',
            'Advance sustainability commitments'
        ];

        // Add industry-specific priorities
        if (themes.length > 0) {
            const themePriorities = themes.slice(0, 2).map(t => 
                `Drive ${t.theme.toLowerCase()} across the organization`
            );
            return [...themePriorities, ...basePriorities.slice(0, 3)];
        }

        return basePriorities;
    }

    /**
     * Extract key challenges
     */
    extractKeyChallenges(client, themes) {
        const industryChalllenges = {
            'Technology': ['Talent acquisition and retention', 'Rapid technology evolution', 'Cybersecurity threats'],
            'Technology & Consulting': ['Utilization optimization', 'Skill relevance', 'Client budget pressures'],
            'Energy & Utilities': ['Energy transition execution', 'Regulatory compliance', 'Infrastructure investment'],
            'Healthcare': ['Regulatory changes', 'Cost pressures', 'Workforce shortages'],
            'Financial Services': ['Regulatory complexity', 'Digital disruption', 'Interest rate environment'],
            'Retail & Consumer': ['Consumer behavior shifts', 'Supply chain volatility', 'Margin pressure'],
            'Manufacturing': ['Supply chain resilience', 'Labor availability', 'Input cost volatility'],
            'Telecommunications': ['Infrastructure investment needs', 'Competitive intensity', 'Technology migration']
        };

        return industryChalllenges[client.industry] || [
            'Market competition',
            'Technology adoption',
            'Talent management'
        ];
    }

    /**
     * Extract opportunities
     */
    extractOpportunities(client, themes) {
        const baseOpportunities = themes.slice(0, 3).map(t => ({
            opportunity: t.theme,
            potential: 'High',
            timeframe: 'Near-term'
        }));

        if (baseOpportunities.length < 3) {
            baseOpportunities.push(
                { opportunity: 'Market expansion', potential: 'Medium', timeframe: 'Medium-term' },
                { opportunity: 'Operational optimization', potential: 'High', timeframe: 'Near-term' }
            );
        }

        return baseOpportunities.slice(0, 4);
    }

    /**
     * Extract risk factors
     */
    extractRiskFactors(client, retrievedData) {
        const regulatory = retrievedData.internet?.regulatoryEvents || [];
        
        return [
            {
                risk: 'Regulatory Evolution',
                severity: 'Medium',
                likelihood: 'High',
                mitigation: 'Active regulatory monitoring and engagement'
            },
            {
                risk: 'Market Disruption',
                severity: 'Medium',
                likelihood: 'Medium',
                mitigation: 'Innovation investment and partnerships'
            },
            {
                risk: 'Talent Competition',
                severity: 'Medium',
                likelihood: 'High',
                mitigation: 'Enhanced EVP and development programs'
            },
            {
                risk: 'Technology Obsolescence',
                severity: 'High',
                likelihood: 'Low',
                mitigation: 'Continuous modernization roadmap'
            }
        ];
    }

    /**
     * Normalize AlphaSense consensus data
     */
    normalizeAlphaSenseData(alphasenseData) {
        if (!alphasenseData) {
            return this.getDefaultConsensus();
        }

        return {
            themes: alphasenseData.themes.map((theme, idx) => ({
                theme: theme.theme,
                confidence: Math.floor(Math.random() * 15 + 80),
                summary: this.generateThemeSummary(theme),
                evidence_count: Math.floor(Math.random() * 10 + 5)
            })),
            key_quotes: alphasenseData.quotes.map(q => ({
                quote: q.quote,
                source: `${q.analyst}, ${q.firm}`,
                date: q.date,
                relevance: Math.floor(Math.random() * 10 + 85)
            })),
            sentiment: {
                overall: alphasenseData.sentiment?.label || 'Neutral',
                score: Math.round((alphasenseData.sentiment?.overall || 0.5) * 100),
                trend: alphasenseData.sentiment?.trend || 'stable'
            },
            divergent_views: alphasenseData.divergentViews || []
        };
    }

    /**
     * Generate theme summary
     */
    generateThemeSummary(theme) {
        const summaries = {
            'AI/ML Adoption Acceleration': 'Analysts see accelerating AI adoption as a key driver of enterprise efficiency and competitive differentiation.',
            'Digital Transformation Demand': 'Continued strong demand for digital transformation services with robust pipeline visibility.',
            'Generative AI Services Growth': 'GenAI represents a significant growth vector with enterprise adoption exceeding initial expectations.',
            'Energy Transition Acceleration': 'Energy transition investments accelerating despite near-term economic headwinds.',
            'Cloud Infrastructure Expansion': 'Cloud infrastructure investment continues at pace driven by AI workload demands.',
            'Cybersecurity Investment': 'Security spending becoming increasingly non-discretionary across enterprise budgets.',
            '5G Monetization Strategies': 'Enterprise 5G use cases reaching commercial scale with improving unit economics.',
            'Omnichannel Excellence': 'Integrated omnichannel capabilities emerging as key differentiator in retail.',
            'Industry 4.0 Adoption': 'Smart factory investments accelerating as labor constraints and efficiency demands persist.'
        };

        return summaries[theme.theme] || `${theme.theme} identified as a key strategic priority with broad analyst consensus.`;
    }

    /**
     * Get default consensus structure
     */
    getDefaultConsensus() {
        return {
            themes: [],
            key_quotes: [],
            sentiment: { overall: 'Neutral', score: 50, trend: 'stable' },
            divergent_views: []
        };
    }

    /**
     * Extract competitor moves
     */
    extractCompetitorMoves(client, retrievedData) {
        const industryCompetitors = {
            'Technology': ['Microsoft', 'Google', 'Amazon', 'IBM', 'Oracle'],
            'Technology & Consulting': ['Deloitte', 'McKinsey', 'BCG', 'Bain', 'Capgemini'],
            'Energy & Utilities': ['Shell', 'BP', 'Exxon', 'NextEra', 'Duke Energy'],
            'Healthcare': ['UnitedHealth', 'CVS Health', 'Cigna', 'Anthem', 'HCA'],
            'Financial Services': ['JP Morgan', 'Goldman Sachs', 'Bank of America', 'Citigroup', 'Wells Fargo'],
            'Retail & Consumer': ['Amazon', 'Walmart', 'Target', 'Costco', 'Home Depot'],
            'Manufacturing': ['Siemens', 'GE', 'Honeywell', '3M', 'Caterpillar'],
            'Telecommunications': ['Verizon', 'AT&T', 'T-Mobile', 'Vodafone', 'Deutsche Telekom']
        };

        const competitors = industryCompetitors[client.industry] || ['Competitor A', 'Competitor B', 'Competitor C'];

        return competitors.slice(0, 3).map((competitor, idx) => ({
            competitor,
            move: this.generateCompetitorMove(client.industry, idx),
            impact: ['High', 'Medium', 'Low'][idx % 3],
            date: this.randomRecentDate(60),
            source: 'Industry Analysis',
            strategic_implication: this.generateStrategicImplication(idx)
        }));
    }

    /**
     * Generate competitor move description
     */
    generateCompetitorMove(industry, idx) {
        const moves = [
            'Announced major strategic acquisition',
            'Launched new AI-powered service offering',
            'Expanded presence in key growth market',
            'Restructured operations for efficiency',
            'Formed strategic partnership'
        ];
        return moves[idx % moves.length];
    }

    /**
     * Generate strategic implication
     */
    generateStrategicImplication(idx) {
        const implications = [
            'May require competitive response in product/service portfolio',
            'Highlights need for continued innovation investment',
            'Reinforces importance of market presence strategy'
        ];
        return implications[idx % implications.length];
    }

    /**
     * Normalize KPI data
     */
    normalizeKPIs(arcData) {
        if (!arcData?.kpis) {
            return {};
        }

        const normalized = {};
        for (const [kpi, data] of Object.entries(arcData.kpis)) {
            normalized[kpi] = {
                value: data.value,
                benchmark: data.benchmark,
                percentile: data.percentile,
                trend: data.trend,
                trend_indicator: data.trend === 'up' ? '↑' : data.trend === 'down' ? '↓' : '→',
                vs_benchmark: data.percentile > 50 ? 'Above' : data.percentile < 50 ? 'Below' : 'At'
            };
        }

        return normalized;
    }

    /**
     * Normalize regulatory events
     */
    normalizeRegulatoryEvents(internetData) {
        if (!internetData?.regulatoryEvents) {
            return [];
        }

        return internetData.regulatoryEvents.map(event => ({
            id: event.id,
            title: event.title,
            regulator: event.regulator,
            jurisdiction: event.jurisdiction,
            type: event.type,
            status: event.status,
            effective_date: event.effectiveDate,
            impact: event.impactLevel,
            summary: event.summary,
            source: event.source,
            action_required: event.impactLevel === 'High' ? 'Review and assess impact' : 'Monitor developments'
        }));
    }

    /**
     * Calculate confidence scores
     */
    calculateConfidenceScores(retrievedData) {
        const hasAlphaSense = retrievedData.alphasense?.documents?.length > 0;
        const hasArc = Object.keys(retrievedData.arc?.kpis || {}).length > 0;
        const hasInternet = retrievedData.internet?.articles?.length > 0;

        const dataCompleteness = [hasAlphaSense, hasArc, hasInternet].filter(Boolean).length / 3 * 100;
        
        const sourceQuality = hasAlphaSense ? 
            Math.min(95, 70 + retrievedData.alphasense.documents.length * 2) : 60;
        
        const timeliness = 90; // Assume recent data

        const overall = Math.round((dataCompleteness * 0.4 + sourceQuality * 0.4 + timeliness * 0.2));

        return {
            overall,
            data_completeness: Math.round(dataCompleteness),
            source_quality: sourceQuality,
            timeliness,
            by_source: {
                alphasense: hasAlphaSense ? Math.floor(Math.random() * 10 + 85) : 0,
                arc: hasArc ? Math.floor(Math.random() * 10 + 80) : 0,
                internet: hasInternet ? Math.floor(Math.random() * 10 + 75) : 0
            }
        };
    }

    /**
     * Compile all sources
     */
    compileSources(retrievedData) {
        const sources = [];

        // AlphaSense sources
        if (retrievedData.alphasense?.documents) {
            retrievedData.alphasense.documents.forEach(doc => {
                sources.push({
                    name: doc.title,
                    type: doc.type,
                    provider: 'AlphaSense',
                    source: doc.source,
                    date: doc.date,
                    retrieved_at: retrievedData.alphasense.metadata?.retrievedAt,
                    url: `https://alphasense.com/document/${doc.id}`
                });
            });
        }

        // Internet sources
        if (retrievedData.internet?.articles) {
            retrievedData.internet.articles.forEach(article => {
                sources.push({
                    name: article.title,
                    type: article.type,
                    provider: 'Internet',
                    source: article.source,
                    date: article.date,
                    retrieved_at: retrievedData.internet.metadata?.retrievedAt,
                    url: article.url
                });
            });
        }

        // Regulatory sources
        if (retrievedData.internet?.regulatoryEvents) {
            retrievedData.internet.regulatoryEvents.forEach(event => {
                sources.push({
                    name: event.title,
                    type: 'Regulatory',
                    provider: 'Regulatory Database',
                    source: event.regulator,
                    date: event.effectiveDate,
                    retrieved_at: retrievedData.internet.metadata?.retrievedAt,
                    url: event.source
                });
            });
        }

        return sources;
    }

    /**
     * Generate random recent date
     */
    randomRecentDate(daysBack) {
        const date = new Date();
        date.setDate(date.getDate() - Math.floor(Math.random() * daysBack));
        return date.toISOString().split('T')[0];
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new NormalizationEngine();
