# Deploiement HexaGram sur le VPS OVH

Cible : VPS OVH `debian@57.128.67.38` (`vps-0b841804.vps.ovh.net`), Debian 13,
**x86_64**, accessible publiquement en HTTPS sur <https://hexagram.davidlardy.com>,
servi par Caddy (statique + reverse-proxy `/api/*` vers le backend Node sur
`127.0.0.1:3001`).

> Depuis le 18/11/2026. L'ancienne VM de la Freebox (`192.168.1.141`, ARM64) est
> **abandonnee** : ne plus jamais y deployer.

- Acces SSH par la cle du PC uniquement (`debian`, sudo sans mot de passe ; root et
  mots de passe refuses).
- Pare-feu ufw : seuls 22, 80 et 443 sont ouverts ; les services restent derriere Caddy.
- Service systemd `hexagram-api` : `/opt/hexagram/server/` (backend + SQLite
  `data/data.db` + `.env`), `/opt/hexagram/app/` (front servi par Caddy),
  utilisateur `freebox`.
- Node 22.11.0 x64 : `/opt/node` -> `/opt/node-v22.11.0-linux-x64` ; l'unite appelle
  `/opt/node/bin/node`.

## Setup initial (deja fait)

Pour memoire, en cas de reinstallation.

### 1. DNS

Enregistrement A `hexagram.davidlardy.com` -> `57.128.67.38` (chez IKOULA).

```bash
dig +short hexagram.davidlardy.com   # doit retourner 57.128.67.38
```

### 2. Repertoire applicatif

```bash
ssh debian@57.128.67.38
sudo mkdir -p /opt/hexagram/app /opt/hexagram/server/data
sudo chown -R freebox:freebox /opt/hexagram
```

### 3. Bloc Caddy

`/etc/caddy/Caddyfile` est **multi-sites : ne jamais l'ecraser**. En faire une copie,
ajouter ou modifier uniquement le bloc `hexagram.davidlardy.com` (cf.
[`vm/Caddyfile.hexagram`](vm/Caddyfile.hexagram)), valider puis recharger :

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy provisionne automatiquement le cert Let's Encrypt (`journalctl -u caddy -n 30`).

## Deploiement courant

Uniquement sur ordre explicite. Depuis le PC :

```powershell
pwsh -File D:\_Perso\HexaGram\deploy\deploy.ps1
```

Etapes :

1. `npm run build` -> `dist/` (frontend)
2. `tsc` dans `server/` -> `dist/` (backend)
3. tar du frontend
4. tar du backend : `dist/` + `package.json` + `package-lock.json`, **sans `node_modules`**
5. scp des tarballs + scripts vers `/tmp/` sur le VPS
6. `sudo bash /tmp/hexagram-sync-app.sh` : extrait dans `/opt/hexagram/app/` + reload Caddy
7. `sudo bash /tmp/hexagram-sync-server.sh` : extrait dans `/opt/hexagram/server/`,
   `npm ci --omit=dev` **sur le VPS** en tant que `freebox`, restart `hexagram-api`,
   puis controles (`systemctl is-active`, `journalctl -n 30`, curl local `127.0.0.1:3001`
   et HTTPS public)

Une fois deploye : <https://hexagram.davidlardy.com>

## Regles

- **Tout ce qui est compile doit l'etre pour linux-x64.** Ne jamais copier de
  `node_modules` depuis le PC (Windows) ni depuis l'ancienne VM (ARM) : les dependances
  sont installees sur le VPS par
  `sudo -u freebox -H bash -c "cd /opt/hexagram/server && PATH=/opt/node/bin:\$PATH npm ci --omit=dev"`.
- **`.env` et base SQLite** : jamais ecrases par un deploiement, ils restent sur le VPS.
  `sync-server.sh` ne touche pas `data/` et n'ajoute `HEXAGRAM_JWT_SECRET` au `.env`
  que s'il est absent.
- Controle manuel apres deploiement :

  ```bash
  sudo systemctl is-active hexagram-api
  journalctl -u hexagram-api -n 30
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/projects   # 401 attendu
  curl -s -o /dev/null -w "%{http_code}\n" https://hexagram.davidlardy.com/
  ```

## Notes

- **HTTPS auto** : Caddy provisionne et renouvelle le cert Let's Encrypt
  automatiquement (challenge HTTP-01 sur port 80).
- **Multi-site** : Caddy route via SNI ; coexiste avec micromoney, pixhub et
  mimosvillages sur le meme VPS.
- **Migration SQL** : au demarrage de `hexagram-api`, les migrations sont appliquees
  de facon idempotente.
- `sync-app.sh` fait un `rm -rf` du contenu de `/opt/hexagram/app/` avant extraction
  pour eviter d'accumuler les anciens chunks hashes de Vite.
- Le service `hexagram-api` lit `HEXAGRAM_JWT_SECRET` depuis `/opt/hexagram/server/.env`.
