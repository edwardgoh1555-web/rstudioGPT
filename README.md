# R/StudioGPT

## Data Retrieval & Schema Application

A sophisticated, AI-assisted intelligence assembly tool that automatically retrieves high-value strategic data from approved sources, normalises heterogeneous inputs into a canonical schema, and produces structured, evidence-linked Source Packs for executive narratives.

![Platform Preview](docs/preview.png)

---

## 🎯 Purpose

This application removes manual research, copy-paste, and structuring work from consultants and client leads by:

- **Automatically retrieving** high-value strategic data from approved sources via APIs
- **Normalising** heterogeneous inputs into a canonical schema
- **Producing** a structured, evidence-linked "Source Pack"
- **Feeding** downstream narrative generation systems reliably and repeatably

---

## ✨ Features

### Core Capabilities
- 🔐 **Secure Authentication** - Role-based access control with SSO-ready architecture
- 📊 **Multi-Source Data Retrieval** - AlphaSense, ARC Database, and Internet sources
- 🤖 **AI-Assisted Normalization** - Intelligent extraction and classification
- ✅ **Schema Validation** - Canonical schema with confidence scoring
- 📋 **Audit Logging** - Complete governance and compliance trail
- 📤 **Export Options** - JSON and Markdown/human-readable formats

### User Experience
- 🎨 Modern, aesthetic dark-theme UI with glassmorphism effects
- 📱 Responsive design for desktop and tablet
- ⏱️ Real-time progress indicators during generation
- 📈 Dashboard with statistics and quick actions
- 📚 Generation history with review capability

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer (Web App)                      │
├─────────────────────────────────────────────────────────────┤
│              Authentication & Permissions                    │
├─────────────────────────────────────────────────────────────┤
│                Secure Configuration Layer                    │
│         ┌──────────────────┬──────────────────┐             │
│         │  Credential Store │ Token Management │             │
│         └──────────────────┴──────────────────┘             │
├─────────────────────────────────────────────────────────────┤
│                  Retrieval Orchestrator                      │
│    ┌──────────────┬──────────────┬──────────────────┐       │
│    │  AlphaSense  │     ARC      │    Internet      │       │
│    │  Connector   │  Connector   │    Retrieval     │       │
│    └──────────────┴──────────────┴──────────────────┘       │
├─────────────────────────────────────────────────────────────┤
│          Normalisation & Schema Layer (AI-Assisted)          │
├─────────────────────────────────────────────────────────────┤
│                  Validation & QA Layer                       │
├─────────────────────────────────────────────────────────────┤
│                    Source Pack Store                         │
├─────────────────────────────────────────────────────────────┤
│                  Audit & Logging Layer                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18.x or later
- **npm** v9.x or later

### Installation

1. **Clone or navigate to the project directory:**
   ```bash
   cd r-studiogpt
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   ```
   http://localhost:3000
   ```

### Demo Credentials

| Username | Password | Role |
|----------|----------|------|
| `client.lead` | `demo123` | Client Lead |
| `industry.lead` | `demo123` | Industry Lead |
| `analyst` | `demo123` | Analyst |
| `admin` | `admin123` | Administrator |

---

## 📖 User Guide

### Generating a Source Pack

1. **Login** with your credentials
2. **Click** "Generate Source Pack" from the dashboard
3. **Select a client** from the searchable list
4. **Configure context**:
   - Industry/Sub-sector
   - Geography
   - Time Horizon (30/90/180/365 days)
   - Output Intent (CEO Narrative, Board Pack, etc.)
5. **Click** "Continue to Generate"
6. **Watch** real-time progress as data is retrieved
7. **Review** the generated Source Pack
8. **Export** as JSON or Markdown

### Admin Functions

Administrators can:
- Configure API credentials (AlphaSense, ARC)
- View audit logs
- Test API connections

---

## 📋 Canonical Schema

The Source Pack follows a canonical schema:

```json
{
  "client": {},
  "context": {},
  "company_profile": {},
  "alphasense_consensus": {},
  "competitor_moves": [],
  "industry_kpis": {},
  "regulatory_events": [],
  "confidence_scores": {},
  "sources": [],
  "metadata": {}
}
```

### Validation States

| Status | Description |
|--------|-------------|
| ✅ Ready | Source Pack passes all validation checks |
| ⚠️ Ready with Caveats | Usable but has quality warnings |
| ❌ Incomplete | Has blocking issues that must be resolved |

---

## 🔐 Security & Governance

### Access Control
- Role-based access control (RBAC)
- Client-account scoping
- Session-based authentication

### Data Handling
- API credentials stored server-side only
- Encrypted at rest
- Never exposed to client/browser
- Rotatable without redeployment

### Auditability
- Full retrieval logs
- API query provenance
- Output traceability
- Complete audit trail

---

## ⚡ Performance Targets

| Step | Target |
|------|--------|
| Authentication | < 5 seconds |
| Retrieval | < 60 seconds |
| Normalisation | < 30 seconds |
| Validation | < 10 seconds |
| **Total** | **< 2 minutes** |

---

## 🗺️ Roadmap

### Phase 1 – MVP ✅
- AlphaSense API integration (demo mode)
- Manual ARC placeholder
- Core schema implementation
- JSON and Markdown export

### Phase 2 – Scale
- ARC API integration
- Internet retrieval module
- Enhanced confidence scoring
- Response caching

### Phase 3 – Productisation
- Microsoft Teams integration
- Industry presets
- Usage analytics
- Multi-tenant support

---

## 📁 Project Structure

```
r-studiogpt/
├── public/
│   ├── index.html          # Main HTML
│   ├── styles.css          # Aesthetic styles
│   └── app.js              # Frontend logic
├── src/
│   ├── middleware/
│   │   └── auth.js         # Authentication middleware
│   └── services/
│       ├── connectors/
│       │   ├── alphasenseConnector.js
│       │   ├── arcConnector.js
│       │   └── internetConnector.js
│       ├── auditLogger.js
│       ├── credentialManager.js
│       ├── normalizationEngine.js
│       ├── retrievalOrchestrator.js
│       └── schemaValidator.js
├── server.js               # Express server
├── package.json
└── README.md
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment | development |
| `SESSION_SECRET` | Session encryption key | (generated) |
| `CREDENTIAL_KEY` | Credential encryption key | (generated) |

### API Credentials (Admin)

Configure via the Admin panel:
- **AlphaSense**: API Key, Client ID, Client Secret
- **ARC Database**: API Key (placeholder)

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

This is an internal enterprise tool. Contact the development team for contribution guidelines.

---

## 📞 Support

For support, contact the R/StudioGPT team.

---

*This application is a governed intelligence assembly tool, not a chat interface.*
