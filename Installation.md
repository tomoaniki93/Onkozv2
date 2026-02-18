# 🚀 ONKOZ — Guide d'Installation

> VPS OVH · Debian 13 · Utilisateur principal : `onkoz`

---

## Prérequis système

```bash
# En tant que root (su -)
apt update && apt upgrade -y
apt install -y curl git nginx certbot python3-certbot-nginx \
               build-essential python3 ufw
```

---

## 1. Installer Node.js 20 LTS

```bash
# En root
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # doit afficher v20.x.x
npm -v
```

---

## 2. Créer l'utilisateur onkoz

```bash
# En root
useradd -m -s /bin/bash onkoz
# (optionnel) ajouter votre clé SSH
# su - onkoz && mkdir ~/.ssh && nano ~/.ssh/authorized_keys
```

---

## 3. Déployer l'application

```bash
# En root
mkdir -p /opt/onkoz
cp -r /chemin/vers/onkoz/* /opt/onkoz/
chown -R onkoz:onkoz /opt/onkoz

# En tant que onkoz
su - onkoz
cd /opt/onkoz
npm install
npm run build:css  # compile client/css/input.css → client/css/style.css (Tailwind)
```

---

## 4. Configurer l'environnement

```bash
# En tant que onkoz
cd /opt/onkoz
cp .env.example .env
nano .env
```

**Valeurs à modifier absolument dans `.env` :**

| Variable | Description | Exemple |
|---|---|---|
| `JWT_SECRET` | Secret JWT (min 32 chars aléatoires) | `openssl rand -hex 32` |
| `MEDIASOUP_ANNOUNCED_IP` | **IP publique** de votre VPS | `51.210.xxx.xxx` |
| `DOMAIN` | Votre domaine | `onkoz.fr` |
| `RTC_MIN_PORT` | Port UDP début (défaut 40000) | `40000` |
| `RTC_MAX_PORT` | Port UDP fin (défaut 49999) | `49999` |
| `MEDIASOUP_NUM_WORKERS` | Nb workers (= nb vCores, max 6) | `4` |

> ⚠️ **MEDIASOUP_ANNOUNCED_IP** est critique : si vous mettez 127.0.0.1, le WebRTC ne fonctionnera pas en production. Utilisez l'IP publique de votre VPS OVH.

Pour trouver l'IP publique :
```bash
curl ifconfig.me
```

---

## 5. Configurer le Firewall (UFW)

```bash
# En root
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 40000:49999/udp   # Ports RTC mediasoup
ufw --force enable
ufw status
```

---

## 6. Configurer Nginx

```bash
# En root
cp /opt/onkoz/nginx/onkoz.conf /etc/nginx/sites-available/onkoz

# Modifier le domaine si différent de onkoz.fr
nano /etc/nginx/sites-available/onkoz

# Activer le site
ln -s /etc/nginx/sites-available/onkoz /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Tester la config
nginx -t

# Redémarrer nginx (sans SSL pour commencer)
systemctl restart nginx
```

---

## 7. Certificat SSL Let's Encrypt

```bash
# En root — remplacer par votre email et domaine
certbot --nginx -d onkoz.fr -d www.onkoz.fr --email votre@email.fr --agree-tos --non-interactive

# Vérifier le renouvellement auto
systemctl status certbot.timer
```

---

## 8. Configurer le service systemd

```bash
# En root
cp /opt/onkoz/nginx/onkoz.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable onkoz
systemctl start onkoz
systemctl status onkoz
```

Vérifier les logs :
```bash
journalctl -u onkoz -f
```

---

## 9. Premier démarrage — Créer le compte Admin

Ouvrez `https://onkoz.fr` dans votre navigateur.

Si c'est la **première installation**, vous verrez automatiquement le formulaire de **Configuration initiale**. Entrez votre pseudo admin et mot de passe.

> ⚠️ **Le pseudo est définitif et ne peut pas être changé.** Choisissez-le avec soin.

---

## 10. Vérifications post-installation

```bash
# Service actif ?
systemctl is-active onkoz

# Nginx OK ?
systemctl is-active nginx

# Ports en écoute ?
ss -tlunp | grep -E '(80|443|3000)'

# Ports UDP mediasoup ouverts ?
ufw status | grep udp
```

---

## Mises à jour

```bash
su - onkoz
cd /opt/onkoz
git pull   # si vous utilisez git
npm install
npm run build:css  # compile client/css/input.css → client/css/style.css (Tailwind)
systemctl restart onkoz   # en root
```

---

## Dépannage courant

| Problème | Solution |
|---|---|
| WebRTC ne connecte pas | Vérifier `MEDIASOUP_ANNOUNCED_IP` = IP publique VPS |
| Pas de son | Vérifier les ports UDP 40000-49999 ouverts dans UFW |
| Erreur 502 | Vérifier `systemctl status onkoz` |
| Certificat SSL | Relancer `certbot --nginx` |
| DB corrompue | Supprimer `/opt/onkoz/data/onkoz.db` et redémarrer |

---

## Commandes utiles

```bash
# Logs en temps réel
journalctl -u onkoz -f

# Redémarrer l'app
systemctl restart onkoz

# Taille de la base de données
du -sh /opt/onkoz/data/onkoz.db

# Accéder à la DB SQLite
sqlite3 /opt/onkoz/data/onkoz.db
.tables
SELECT id, username, role FROM users;
.quit
```
