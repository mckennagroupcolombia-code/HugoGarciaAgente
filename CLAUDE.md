# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered sales & operations agent for McKenna Group (pharmaceutical raw materials). The agent acts as "Hugo García," a sales representative that handles WhatsApp conversations, MeLi order management, SIIGO invoicing, and Google Sheets inventory — all orchestrated via Gemini AI.

## Running the Application

```bash
# Production (with Cloudflare tunnel for webhooks)
./start.sh

# Development (no tunnel, Flask dev server on port 8081)
source venv/bin/activate
python3 agente_pro.py

# Health check
curl http://localhost:8081/status
```

## CLI Menu (interactive, runs alongside the server)

The app launches an 11-option CLI menu in a background thread. Options include:
- `1` — Chat with the agent
- `2` — Smart sync (MeLi pending orders → SIIGO)
- `3/4` — Recent invoice sync (1 or 10 days)
- `5` — Full sync + inventory report
- `7` — Manual sync by Pack ID
- `8` — Force AI learning from MeLi Q&A history
- `9` — Sync by specific date
- `10` — Sync SIIGO purchase orders from Gmail

## Architecture

```
agente_pro.py          → Flask app creation + CLI thread + server start (:8081)
app/core.py            → Gemini AI config, system prompt (INSTRUCCIONES_MCKENNA), tool registration
app/routes.py          → Flask endpoints: /whatsapp (webhook), /chat (authenticated), /status
app/cli.py             → Interactive CLI menu
app/sync.py            → Cross-platform sync logic (MeLi ↔ SIIGO)
app/services/
  meli.py              → Mercado Libre API (orders, fiscal docs, post-sale, learning)
  meli_preventa.py     → Pre-sale MeLi functions
  siigo.py             → SIIGO ERP (invoices, quotations, PDF download)
  google_services.py   → Google Sheets (inventory reads/writes)
app/tools/
  memoria.py           → SQLite + ChromaDB vector DB access
  system_tools.py      → File ops, backup, script execution, email
modulo_posventa.py     → Post-sale message handling for MeLi buyers
```

## Key Data Flows

**Sales (WhatsApp → Invoice → MeLi upload):**
1. Customer message arrives at `/whatsapp` via Evolution API webhook
2. `core.py` processes it through Gemini with 40+ registered tools
3. Agent queries Google Sheets for inventory/pricing
4. On sale confirmation: creates SIIGO invoice → downloads PDF → uploads to MeLi order

**Post-sale approvals (human-in-the-loop):**
- Payment proof: team sends `pago ok <sender_id>` to trigger invoice creation
- Post-sale responses: team sends `hugo dale ok <order_id>` to send drafted reply

**Smart sync:**
- Finds MeLi orders missing fiscal documents
- Matches against SIIGO invoices by Pack ID
- Auto-uploads PDFs to MeLi

## Configuration

All credentials come from `.env` (copy `.env.example`) and JSON credential files:
- `credenciales_meli.json` — Mercado Libre OAuth tokens (auto-refreshed)
- `credenciales_google.json` — Google OAuth
- `credenciales_SIIGO.json` — SIIGO API credentials
- `client_secret_cloud.json` — Google Cloud OAuth

Key `.env` variables: `GOOGLE_API_KEY`, `MELI_CREDS_PATH`, `SPREADSHEET_ID`, `TDS_FOLDER_ID`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `INSTANCE_NAME`, `CHAT_API_TOKEN`

The tunnel public URL is captured automatically from Cloudflare output and saved to `tunnel_url.txt`.

## AI Configuration (`app/core.py`)

- Model: Gemini 2.5-Pro
- System prompt defines Hugo García's persona, tone (direct Colombian business Spanish), and strict anti-loop rules
- Tools are registered as callable functions passed to Gemini; adding a new tool requires registering it in `core.py`

## Data Stores

- **SQLite** — conversation/interaction history (`app/tools/memoria.py`)
- **ChromaDB** — vector DB for learned MeLi Q&A patterns (`memoria_vectorial/`)
- **Google Sheets** — live inventory and product catalog
- **Local files** — draft quotations (`cotizaciones_preliminares/`), downloaded invoices (`facturas_descargadas/`)
