# R/StudioGPT

## Narrative Intelligence Platform

A governed, AI-powered desktop application that automates the end-to-end origination workflow — from strategic data retrieval and evidence assembly, through qualification, value case development, provocation document generation, and C-suite review — producing fully formatted, evidence-linked .docx deliverables at each stage.

---

## Table of Contents

- [Overview](#overview)
- [7-Step Workflow](#7-step-workflow)
- [Architecture](#architecture)
- [AI Agents & Pipelines](#ai-agents--pipelines)
- [Services & Connectors](#services--connectors)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Admin Panel](#admin-panel)
- [Security & Governance](#security--governance)
- [Build & Distribution](#build--distribution)
- [License](#license)

---

## Overview

R/StudioGPT removes manual research, copy-paste, and document structuring from the origination process. It operates as a standalone Electron desktop application that:

- **Retrieves** strategic data from approved sources (AlphaSense, ARC, Internet) and user-uploaded documents
- **Parses & chunks** PDFs, DOCX, PPTX, XLSX, CSV, and plain text into a searchable corpus
- **Generates** structured, evidence-linked deliverables at each workflow step via OpenAI
- **Produces** fully formatted .docx files with professional styling, tables, and headings
- **Auto-feeds** each step's output into the next step's context (corpus accumulation)
- **Tracks** full session history with restore capability
- **Provides** a real-time AI console showing agent activity across all generation steps

---

## 7-Step Workflow

The core application follows a sequential 7-step wizard:

### Step 1 — Select Client
Choose from a pre-loaded client list (blue-chip accounts) or create a new client using AI-assisted company research. AI client creation uses OpenAI web search to auto-populate industry, geography, sector, description, and key contacts.

### Step 2 — Configure
Set the client's industry, geography, and upload a **Point of Contact (POC)** file. The POC document is parsed (PDF/DOCX/XLSX/TXT) and its content is used as context in downstream generation steps. Contacts can be extracted from the POC automatically using AI.

### Step 3 — Upload Supporting Documents
Upload multiple supporting documents (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, images). Documents are processed through the **Document Chunker** service which:
- Extracts text from each format using specialised parsers
- Splits content into ~512-token chunks with 64-token overlap
- Extracts structural metadata (headings, bullets, tables, entities, numbers)
- Builds a searchable corpus with stable chunk IDs for retrieval

### Step 4 — Qualification (42 Questions)
Generates a comprehensive qualification assessment document. The system:
1. Builds context from the entire supporting docs corpus
2. Interpolates client variables (name, industry, geography) into a configurable prompt
3. Calls OpenAI to generate a detailed markdown qualification document
4. Post-processes the markdown (cleans formatting artefacts)
5. Builds a formatted .docx file using the DOCX builder
6. **Auto-chunks** the qualification output and merges it into the corpus for downstream steps

### Step 5 — Value Case
Generates a value case document using the same pattern as qualification:
1. Assembles all corpus context (including qualification output from Step 4)
2. Uses a dedicated, admin-configurable value case prompt
3. Calls OpenAI with the full context
4. Produces a formatted .docx
5. **Auto-chunks** the value case and merges into the corpus for provoke generation

### Step 6 — Provoke (Origination Engine)
Generates the provocation / origination engine document:
1. Builds context from the full corpus (now includes qualification + value case)
2. Uses a configurable provocation prompt that references all previous analysis
3. Generates via OpenAI with a system prompt mentioning the value case from Step 5
4. Produces a formatted .docx
5. **Auto-chunks** the provocation output into the corpus

### Step 7 — Review (C-Suite Consistency Check)
Presents all generated assets and enables C-suite persona-based review:
- **Asset Summary** — displays all generated documents (Qualification, Value Case, Provocation, plus any rewrite versions) with file sizes and download buttons
- **C-Suite Reviewer Tiles** — select a persona (CEO, CFO, COO, CTO, CHRO, CMO) to generate a role-specific consistency and accuracy review of the provocation document
- **Rewrite** — after review, can rewrite the provocation incorporating the reviewer's feedback, creating versioned alternatives
- Per-role reviews are tracked and stored independently

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Main Process (main.js)               │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │  OpenAI API │ │ Rate Limiter │ │   Adaptive   │              │
│  │  (GPT-5.x)  │ │  (500ms min  │ │   Timeouts   │              │
│  │              │ │   between    │ │ (8min GPT-5,  │              │
│  │              │ │   calls)     │ │  3min other)  │              │
│  └────────────┘ └──────────────┘ └──────────────┘              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   IPC Handlers (~87)                       │   │
│  │  auth · clients · config · sourcePack · supportingDocs    │   │
│  │  qualification · valueCase · provocation · review         │   │
│  │  templates · settings · narrative · workshop · intelPack  │   │
│  │  sourceChat · narrativeChat · placeholders · files        │   │
│  │  session · appData · audit · health                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     Service Layer                         │   │
│  │  credentialManager · retrievalOrchestrator                │   │
│  │  normalizationEngine · schemaValidator · auditLogger      │   │
│  │  documentChunker                                          │   │
│  │  connectors: alphasense · arc · internet                  │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    Preload Bridge (preload.js)                    │
│           Context-isolated IPC bridge (~330 lines)               │
│  Exposes: electronAPI.{auth, clients, config, sourcePack,        │
│    supportingDocs, qualification, valueCase, provocation,        │
│    review, templates, settings, narrative, workshop, intelPack,  │
│    sourceChat, narrativeChat, placeholders, files, session,      │
│    appData, audit, health, shell}                                │
├─────────────────────────────────────────────────────────────────┤
│                    Renderer Process (public/)                     │
│  index.html · app.js (~5,600 lines) · styles.css (~7,200 lines) │
│  Dark-theme UI with glassmorphism · 7-step wizard                │
│  Dashboard · Generate · History · Admin views                    │
│  Real-time AI Console · Toast notifications                      │
│  Session history with full state restore                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## AI Agents & Pipelines

### OpenAI Integration
All AI generation uses the `callOpenAI()` utility which provides:
- **Rate limiting** — minimum 500ms between API calls, queued execution
- **Automatic retry** — up to 3 retries with exponential backoff on rate limits (429), server errors (5xx), and network failures
- **No fallback** — GPT-5 series only; if the model is unavailable the user is prompted to try again
- **Settled guard** — prevents timeout→destroy→error double-fire from spawning zombie retry chains
- **Adaptive timeouts** — 8 minutes for GPT-5.x Responses API (large context), 3 minutes for other models
- **Responses API support** — GPT-5.x models use the `/v1/responses` endpoint with `instructions` field; older models use `/v1/chat/completions`
- **Model-aware parameters** — o1/o3 models use `max_completion_tokens`; o1 models skip `temperature`

### Qualification Agent (Step 4)
Single-pass OpenAI generation with a configurable system prompt. Produces the "42 Questions" qualification assessment. Output is auto-chunked and merged into the corpus.

### Value Case Agent (Step 5)
Same pattern as qualification — single-pass generation with a dedicated prompt. Output is auto-chunked and merged into the corpus so it becomes available context for provocation generation.

### Provocation Agent (Step 6)
Single-pass generation that consumes the full accumulated corpus (supporting docs + qualification + value case). Produces the origination engine document. Output is auto-chunked.

### Review Agent (Step 7)
Generates C-suite persona reviews of the provocation document. Uses role-specific prompts (CEO, CFO, COO, CTO, CHRO, CMO) configured in the admin panel. Each role gets its own system prompt framing the review perspective.

### Rewrite Agent (Step 7)
Takes a specific C-suite review's feedback and rewrites the provocation document incorporating suggestions. Creates a new versioned document (tracked in a `provokeVersions` array).

### Multi-Agent Narrative Pipeline
A separate 3-stage pipeline for narrative generation from Source Packs:

| Agent | Role | Output |
|-------|------|--------|
| **Analyst** | Extracts key insights from ALL source documents, identifies themes, evidence, and strategic signals | Structured insight brief |
| **Strategist** | Maps insights to narrative structure, identifies the strategic story arc | Narrative architecture |
| **Narrator** | Writes the final executive narrative using the strategist's structure and analyst's evidence | Polished executive narrative |

### Source Chat Agent
Conversational Q&A interface over loaded Source Pack documents. Maintains chat history for multi-turn conversations. Used for exploring and interrogating source materials before narrative generation.

### Narrative Chat Agent
Interactive editing assistant for refining generated narratives. Supports:
- **Ask mode** — answer questions about the narrative
- **Edit mode** — suggest changes to highlighted text
- **Full rewrite mode** — regenerate the entire narrative with new instructions

### Client AI Creation Agent
Uses OpenAI web search to research a company name and auto-populate a full client profile including industry, geography, sector, description, revenue, employee count, and key executives.

### Contact Research Agent
Uses OpenAI web search to find current and former C-suite contacts for a client. Can also extract contacts from uploaded POC documents via AI parsing.

### Intel Pack Generator
Produces a formatted Client Intelligence Pack combining narrative content with POC analysis, generating structured sections via OpenAI.

### Workshop Materials Generator
Generates or populates PPTX and DOCX workshop materials. Supports uploaded templates with placeholder substitution, or generates blank structured files. Uses PptxGenJS for presentations and Docxtemplater for document templates.

---

## Services & Connectors

### Credential Manager (`src/services/credentialManager.js`)
- AES-encrypted credential storage persisted to disk (`credentials.enc`)
- Application data storage with encryption (`appdata.enc`)
- In-memory caching with debounced disk writes
- Token management with expiry tracking
- Stored in Electron's `userData` directory

### Retrieval Orchestrator (`src/services/retrievalOrchestrator.js`)
Coordinates multi-source data retrieval with progress tracking:
1. Authentication to data sources
2. AlphaSense insights pull
3. ARC benchmarks pull
4. Internet regulatory signals
5. Normalisation & validation
6. Source Pack finalisation

### Document Chunker (`src/services/documentChunker.js`)
Core document processing pipeline:
- **Supported formats**: PDF, DOCX, PPTX, XLSX, XLS, CSV, MD, TXT, RTF, HTML, JSON, images, EML/MSG
- **Chunking strategy**: ~512-token target chunks with 64-token overlap
- **Chunk metadata**: stable IDs (SHA-256), source anchors, structural annotations
- **Structure extraction**: headings, bullets, tables, entities, numbers
- **Corpus operations**: `processDocument()`, `processDocumentBatch()`, `searchCorpus()`
- **Lazy-loaded parsers**: mammoth (DOCX), pdfjs-dist (PDF), PizZip (PPTX), xlsx (XLSX), csv-parse (CSV)

### Normalisation Engine (`src/services/normalizationEngine.js`)
AI-assisted extraction, classification, and schema normalisation of retrieved data into the canonical Source Pack schema including: company profile, AlphaSense consensus, competitor moves, industry KPIs, regulatory events, confidence scores, and source compilation.

### Schema Validator (`src/services/schemaValidator.js`)
Validates Source Packs against the canonical schema:
- Required field checking (client, context, company_profile, sources, metadata, etc.)
- Completeness scoring
- Quality validation
- Confidence threshold verification
- Status levels: Ready ✅ | Ready with Caveats ⚠️ | Incomplete ❌

### Audit Logger (`src/services/auditLogger.js`)
Comprehensive governance logging:
- Authentication events
- Data retrieval operations
- Generation events
- Admin configuration changes
- In-memory store (max 10,000 entries), queryable via IPC

### AlphaSense Connector (`src/services/connectors/alphasenseConnector.js`)
Real API integration for analyst insights, research reports, and market signals:
- OAuth2 client credentials flow or direct API key authentication
- Token caching with automatic refresh
- Falls back to simulated data when not configured

### ARC Connector (`src/services/connectors/arcConnector.js`)
Accenture Research Catalog (ARC) integration:
- Structured and unstructured search endpoints (`oneassetapi.accenture.com`)
- Industry mapping to ARC taxonomy
- Falls back to simulated data when not configured

### Internet Connector (`src/services/connectors/internetConnector.js`)
Regulatory and news signal retrieval from whitelisted domains:
- SEC, Reuters, Bloomberg, FT, WSJ, gov.uk, europa.eu, Federal Reserve, ECB
- Currently simulated; designed for real API integration in Phase 2

---

## Project Structure

```
r-studiogpt/
├── main.js                          # Electron main process (~9,400 lines)
│                                    #   All IPC handlers, OpenAI integration,
│                                    #   document processing, generation pipelines
├── preload.js                       # Secure IPC bridge (~330 lines)
├── server.js                        # Express server (legacy web mode)
├── package.json                     # Dependencies & build config
├── LaunchApp.bat                    # Windows launcher (delegates to VBS)
├── LaunchApp.vbs                    # Hidden-window Electron launcher
├── splash-native.hta                # Native HTA splash screen
├── splash-native.ps1                # PowerShell splash helper
├── LICENSE.txt                      # End User License Agreement
│
├── public/
│   ├── index.html                   # Main application HTML (~1,600 lines)
│   ├── app.js                       # Frontend logic (~5,600 lines)
│   ├── styles.css                   # Dark-theme styles (~7,200 lines)
│   └── splash.html                  # Electron splash screen
│
├── src/
│   ├── middleware/
│   │   └── auth.js                  # Authentication middleware (legacy web)
│   └── services/
│       ├── credentialManager.js     # Encrypted credential storage (~640 lines)
│       ├── retrievalOrchestrator.js # Multi-source data retrieval (~230 lines)
│       ├── normalizationEngine.js   # AI-assisted normalisation (~430 lines)
│       ├── schemaValidator.js       # Source Pack validation (~360 lines)
│       ├── auditLogger.js           # Governance audit trail (~230 lines)
│       ├── documentChunker.js       # Document parsing & chunking (~900 lines)
│       └── connectors/
│           ├── alphasenseConnector.js  # AlphaSense API (~810 lines)
│           ├── arcConnector.js         # ARC API (~860 lines)
│           └── internetConnector.js    # Internet retrieval (~280 lines)
│
├── assets/
│   ├── icon.ico                     # Windows icon
│   ├── icon.png                     # PNG icon
│   └── icon.svg                     # SVG source icon
│
├── scripts/
│   ├── create-icon.js               # Icon generation script
│   └── generate-icons.js            # Multi-format icon generation
│
└── dist/                            # Build output directory
```

---

## Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `openai` | ^6.15.0 | OpenAI API client (GPT-5.x Responses API + Chat Completions) |
| `axios` | ^1.6.0 | HTTP client for external API calls |
| `docx` | ^9.5.1 | DOCX generation (Document, Paragraph, TextRun, Table, etc.) |
| `docxtemplater` | ^3.67.6 | DOCX template processing with placeholder substitution |
| `pizzip` | ^3.2.0 | ZIP handling for DOCX/PPTX template processing |
| `pptxgenjs` | ^4.0.1 | PowerPoint PPTX generation for workshop materials |
| `pdf-parse` | ^2.4.5 | PDF text extraction (fallback parser) |
| `pdf2json` | ^4.0.1 | PDF to JSON conversion |
| `pdfjs-dist` | ^3.11.174 | Mozilla PDF.js for Node.js — primary PDF text extraction |
| `mammoth` | ^1.11.0 | DOCX to text/HTML conversion for document chunking |
| `xlsx` | ^0.18.5 | Excel/CSV spreadsheet parsing |
| `csv-parse` | ^6.1.0 | CSV parsing for structured data extraction |
| `crypto-js` | ^4.2.0 | AES encryption for credential and app data storage |
| `bcryptjs` | ^2.4.3 | Password hashing for authentication |
| `uuid` | ^9.0.1 | UUID generation for IDs, request tracking, audit entries |
| `archiver` | ^6.0.2 | ZIP archive creation for Source Pack export |
| `@runwayml/sdk` | ^3.11.0 | RunwayML SDK (reserved for future media generation) |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Desktop application framework |
| `electron-builder` | ^24.9.1 | Packaging and distribution (NSIS installer, DMG, AppImage) |
| `png-to-ico` | ^3.0.1 | Icon format conversion for build process |

---

## Getting Started

### Prerequisites

- **Node.js** v18.x or later
- **npm** v9.x or later
- **OpenAI API Key** — required for all AI generation features

### Installation

```bash
# Clone or navigate to the project directory
cd narrative-intelligence-platform

# Install dependencies
npm install

# Start the application
npm start
```

### Quick Launch (Windows)

Double-click **LaunchApp.bat** to start with a native splash screen.

### Demo Credentials

| Username | Password | Role |
|----------|----------|------|
| `client.lead` | `demo123` | Client Lead |
| `industry.lead` | `demo123` | Industry Lead |
| `analyst` | `demo123` | Analyst |
| `admin` | `admin123` | Administrator |

---

## Configuration

### API Credentials (Admin Panel)

Configure via **Admin → Credentials**:

| Provider | Required Fields | Purpose |
|----------|----------------|---------|
| **OpenAI** | API Key | All AI generation (qualification, value case, provoke, review, narrative, chat) |
| **AlphaSense** | API Key _or_ Client ID + Secret | Market intelligence and analyst insights |
| **ARC** | API Key | Accenture Research Catalog assets and solutions |

### OpenAI Model Support

The application automatically selects the appropriate API based on model name:

| Model Family | API Used | Token Parameter |
|-------------|----------|-----------------|
| `gpt-5.x` | Responses API (`/v1/responses`) | `max_output_tokens` |
| `o1-*` | Chat Completions | `max_completion_tokens` (no temperature) |
| `o3-*` | Chat Completions | `max_completion_tokens` |

No fallback model — if GPT-5 is unavailable, the user is prompted to retry.

### Data Storage

All application data is stored in the Electron `userData` directory:
- **credentials.enc** — AES-encrypted API credentials
- **appdata.enc** — AES-encrypted application state (clients, settings, templates, history)

---

## Admin Panel

The admin panel provides configuration for:

### Credential Management
- OpenAI, AlphaSense, and ARC API key configuration
- Connection testing for each provider
- Masked credential display

### Prompt Configuration
All generation prompts are customisable:

| Prompt | Step | Description |
|--------|------|-------------|
| Qualification Prompt | Step 4 | System prompt for the 42-question qualification assessment |
| Value Case Prompt | Step 5 | System prompt for value case document generation |
| Provocation Prompt | Step 6 | System prompt for the origination engine document |
| C-Suite Prompts | Step 7 | Per-role prompts for CEO, CFO, COO, CTO, CHRO, CMO reviews |
| Source Prompts | Source Pack | Per-source prompts for ChatGPT, ARC, and AlphaSense retrieval |
| Default Agent Prompt | Narrative | System prompt for the multi-agent narrative pipeline |

### Template Management
- Upload custom PPTX/DOCX templates for workshop generation
- Manage placeholder definitions for template substitution
- Import/export placeholder configurations

### Audit Logs
- View complete audit trail of all system operations
- Filter by category (AUTH, RETRIEVAL, ADMIN, etc.)

---

## Security & Governance

### Context Isolation
- Renderer process has **no direct access** to Node.js APIs
- All communication via the preload.js IPC bridge
- `contextIsolation: true`, `nodeIntegration: false`

### Credential Security
- API credentials encrypted with AES (CryptoJS) before disk storage
- Never exposed to the renderer process
- Token caching with automatic expiry

### Access Control
- Role-based access (Client Lead, Industry Lead, Analyst, Admin)
- Session-based authentication
- Admin-only access to credential and prompt configuration

### Audit Trail
- All retrieval, generation, and configuration operations logged
- Timestamps, categories, and action details captured
- In-memory store with 10,000 entry retention

---

## Build & Distribution

### Build Commands

```bash
# Build for current platform
npm run build

# Platform-specific builds
npm run build:win     # Windows (NSIS installer)
npm run build:mac     # macOS (DMG)
npm run build:linux   # Linux (AppImage)

# Windows distribution shortcut
npm run dist
```

### Build Output

| Platform | Format | Output |
|----------|--------|--------|
| Windows | NSIS Installer | `dist/R-StudioGPT-Setup-{version}.exe` |
| macOS | DMG | `dist/R-StudioGPT-{version}.dmg` |
| Linux | AppImage | `dist/R-StudioGPT-{version}.AppImage` |

### Build Configuration

Defined in `package.json` under `build`:
- **App ID**: `com.rstudiogpt.app`
- **Product Name**: R/StudioGPT
- Desktop and Start Menu shortcuts (Windows)
- Code signing disabled by default (`signAndEditExecutable: false`)

---

## License

Copyright © 2026 R/StudioGPT Team. All rights reserved.

This software is provided for authorised business use only. See [LICENSE.txt](LICENSE.txt) for full terms.
