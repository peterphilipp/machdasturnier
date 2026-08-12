# 📄 paperless-ngx – Lokales Dokumentenmanagement mit KI

## Was ist paperless-ngx?

Open-Source-Dokumentenverwaltung mit **lokaler OCR**, **KI-Klassifizierung** und **Volltextsuche**.  
Alles läuft auf deinem Rechner – keine Cloud, keine Abos.

---

## 🚀 Schnellstart (3 Schritte)

### 1. Docker prüfen
```bash
docker --version
docker compose version
```
Falls nicht installiert: [Docker Desktop für Windows](https://www.docker.com/products/docker-desktop/)

### 2. Starten
```bash
cd paperless-ngx
docker compose up -d
```

### 3. Öffnen
Browser auf **http://localhost:8001** öffnen  
Login: `admin` / `admin123`

---

## ⚙️ Konfiguration (`docker-compose.yml`)

| Einstellung | Wert | Beschreibung |
|-------------|------|--------------|
| Port | `8001` | Ändern mit `- "NEUER_PORT:8000"` |
| Admin-User | `admin` | Ändern in `PAPERLESS_ADMIN_USER` |
| Admin-Passwort | `admin123` | Ändern in `PAPERLESS_ADMIN_PASSWORD` |
| OCR-Sprachen | `deu eng` | Deutsche + Englische OCR |
| Consumer-Intervall | `60s` | Prüft alle 60 Sekunden auf neue Dokumente |

### Wichtige Pfade (Docker Volumes)
```
data/        → Datenbank & Metadaten
media/       → Hochgeladene Dokumente (PDFs, Bilder)
export/      → Exportierte Dokumente
consume/     → Watch-Folder: Hier Dokumente ablegen = automatischer Import
```

---

## 🤖 KI-Features

### Automatische Verschlagwortung
Nach dem ersten Import klassifiziert paperless-ngx Dokumente automatisch nach:
- **Organisations-Tags** (z. B. "Rechnung", "Versicherung")
- **Dokumenten-Typ** (Rechnung, Vertrag, Brief)
- **Erstelltem Datum**

### OCR (Tesseract)
- Erkennt Text aus gescannten PDFs und Bildern
- Unterstützt Deutsch (`deu`) und Englisch (`eng`)
- Weitere Sprachen: [tesseract-ocr Daten](https://github.com/tesseract-ocr/tessdata)

---

## 📦 Wichtige Docker-Befehle

```bash
# Starten
docker compose up -d

# Logs ansehen
docker compose logs -f webserver

# Stoppen
docker compose down

# Neustart nach Konfigurationsänderung
docker compose restart webserver

# Datenbank-Backup
docker compose exec db pg_dump -U paperless paperless > backup_$(date +%Y%m%d).sql

# Datenbank-Wiederherstellung
cat backup.sql | docker compose exec -T db psql -U paperless paperless
```

---

## 🔧 Troubleshooting

### Problem: Container starten nicht
```bash
docker compose down -v          # Alle Volumes löschen
docker compose up -d            # Neu starten
```

### Problem: OCR funktioniert nicht
- Stelle sicher, dass `PAPERLESS_OCR_LANGUAGES` die gewünschten Sprachen enthält
- Tesseract-Daten für weitere Sprachen herunterladen und einbinden

### Problem: Langsame Performance
- paperless-ngx benötigt mindestens **2 GB RAM** (empfohlen: 4 GB)
- SSD für die Volumes empfohlen

---

## 📚 Weitere Ressourcen

- [Offizielle Dokumentation](https://docs.paperless-ngx.com/)
- [GitHub Repository](https://github.com/paperless-ngx/paperless-ngx)
- [Community Forum](https://github.com/paperless-ngx/paperless-ngx/discussions)
