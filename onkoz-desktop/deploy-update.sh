#!/bin/bash
# ── deploy-update.sh ──────────────────────────────────────────────────────────
# Déploie les fichiers de mise à jour sur le VPS après un build.
#
# Usage :
#   ./deploy-update.sh
#
# Prérequis :
#   - Avoir lancé "npm run build:win" au préalable
#   - Avoir accès SSH au VPS (clé ou mot de passe)
# ─────────────────────────────────────────────────────────────────────────────

VPS_USER="root"
VPS_HOST="51.255.194.141"     # IP de ton VPS
VPS_PATH="/opt/onkoz/client/updates"   # dossier servi par le site

echo "📦 Fichiers dans dist/ :"
ls -lh dist/*.exe dist/*.yml dist/*.yaml 2>/dev/null

echo ""
echo "🚀 Envoi sur le VPS..."

# Créer le dossier si besoin
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_PATH"

# Copier les fichiers nécessaires :
#   - ONKOZ Setup X.X.X.exe     (installateur)
#   - ONKOZ X.X.X.exe           (portable)
#   - latest.yml                 (metadata lu par electron-updater)
scp dist/*.exe dist/latest.yml "$VPS_USER@$VPS_HOST:$VPS_PATH/"

echo ""
echo "✅ Déployé sur https://onkoz.fr/updates/"
echo "   L'app vérifiera la mise à jour au prochain démarrage."
