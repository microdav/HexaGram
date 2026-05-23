# Deploiement HexaGram sur la VM Freebox Ultra

Cible : VM locale `freebox@192.168.1.141`, **LAN only**, port **6503**, servi par Caddy en static (`file_server`).

## Setup initial (one-shot)

A faire **une seule fois** sur la VM avant le premier `deploy.ps1`.

### 1. Provisionner le repertoire applicatif

```bash
ssh freebox@192.168.1.141
sudo mkdir -p /opt/hexagram/app
sudo chown -R freebox:freebox /opt/hexagram
```

### 2. Ajouter le bloc Caddy

Concatener le contenu de [`vm/Caddyfile.hexagram`](vm/Caddyfile.hexagram) a la fin de `/etc/caddy/Caddyfile` (sans toucher au bloc `micromoney.davidlardy.com`), puis :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verification : `curl -I http://192.168.1.141:6503/` doit repondre 404 (normal tant que `dist/` n'a pas ete deploye) ou 200.

## Deploiement courant

Depuis le PC, tout est dans `deploy.ps1` :

```powershell
pwsh -File D:\_Perso\HexaGram\deploy\deploy.ps1
```

Etapes :
1. `npm run build` -> `dist/`
2. tar du contenu de `dist/`
3. scp du tar + de `sync-app.sh` vers `/tmp/` sur la VM
4. `sudo bash /tmp/hexagram-sync-app.sh` qui extrait dans `/opt/hexagram/app/` et reload Caddy

Une fois deploye : http://192.168.1.141:6503

## Notes

- **Pas de HTTPS** : LAN only, aucun port forward Freebox necessaire.
- Caddy est partage avec microMoney. Le reload est non-disruptif (zero downtime sur micromoney.davidlardy.com).
- `sync-app.sh` fait un `rm -rf` du contenu de `/opt/hexagram/app/` avant extraction pour eviter d'accumuler les anciens chunks hashes de Vite.
