# Deploiement HexaGram sur la VM Freebox Ultra

Cible : VM `freebox@192.168.1.141`, accessible publiquement en HTTPS sur
<https://hexagram.davidlardy.com>, servi par Caddy (statique +
reverse-proxy `/api/*` vers le backend Node sur `localhost:3001`).

## Setup initial (one-shot)

A faire **une seule fois** sur la VM avant le premier `deploy.ps1`.

### 1. DNS A record (chez le registrar)

Ajouter un enregistrement DNS de type A :

| Nom                       | Type | Valeur                    |
| ------------------------- | ---- | ------------------------- |
| `hexagram.davidlardy.com` | A    | `<IP publique Freebox>`   |

> L'IP publique de la Freebox se trouve dans Freebox OS -> Etat reseau,
> ou via `curl ifconfig.me` depuis la VM.

Verifier la propagation :

```bash
dig +short hexagram.davidlardy.com
# doit retourner l'IP publique de la Freebox
```

### 2. Forward des ports (deja en place pour micromoney)

Sur la Freebox (Paramètres -> Gestion des ports), verifier que les
redirections suivantes pointent vers la VM `192.168.1.141` :

| Port externe | Protocole | Vers                |
| ------------ | --------- | ------------------- |
| 80           | TCP       | 192.168.1.141:80    |
| 443          | TCP       | 192.168.1.141:443   |

> Port 80 est utilise par Let's Encrypt pour le challenge HTTP-01.
> Port 443 sert tout le trafic HTTPS (multi-site via SNI).

### 3. Provisionner le repertoire applicatif sur la VM

```bash
ssh freebox@192.168.1.141
sudo mkdir -p /opt/hexagram/app /opt/hexagram/server/data
sudo chown -R freebox:freebox /opt/hexagram
```

### 4. Ajouter le bloc Caddy

Concatener le contenu de [`vm/Caddyfile.hexagram`](vm/Caddyfile.hexagram) a la
fin de `/etc/caddy/Caddyfile` (sans toucher au bloc `micromoney.davidlardy.com`).

Puis valider et reload :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

A ce stade, Caddy provisionne automatiquement le cert Let's Encrypt pour
`hexagram.davidlardy.com` (visible dans les logs : `journalctl -u caddy -n 30`).

Verification :

```bash
curl -I https://hexagram.davidlardy.com/
# doit repondre 404 tant que dist/ n'a pas encore ete deploye
```

## Deploiement courant

Depuis le PC, tout est dans `deploy.ps1` :

```powershell
pwsh -File D:\_Perso\HexaGram\deploy\deploy.ps1
```

Etapes :

1. `npm run build` -> `dist/` (frontend)
2. `tsc` dans `server/` -> `dist/` (backend)
3. tar du frontend + tar du backend (avec `node_modules` prod inclus)
4. scp des tarballs + scripts vers `/tmp/` sur la VM
5. `sudo bash /tmp/hexagram-sync-app.sh` : extrait dans `/opt/hexagram/app/` + reload Caddy
6. `sudo bash /tmp/hexagram-sync-server.sh` : extrait dans `/opt/hexagram/server/` + restart `hexagram-api.service`

Une fois deploye : <https://hexagram.davidlardy.com>

## Notes

- **HTTPS auto** : Caddy provisionne et renouvelle le cert Let's Encrypt
  automatiquement (challenge HTTP-01 sur port 80).
- **Multi-site sur la VM** : Caddy ecoute sur un seul port 443 et route via SNI.
  Coexiste avec `micromoney.davidlardy.com` sans configuration reseau supplementaire.
- **Migration SQL** : au demarrage de `hexagram-api`, les colonnes `project_id` sont
  ajoutees aux tables existantes si absentes, et un projet "Hexapode Project" est
  cree pour chaque utilisateur dont les profils/sequences/programmes sont orphelins.
  Idempotent.
- `sync-app.sh` fait un `rm -rf` du contenu de `/opt/hexagram/app/` avant extraction
  pour eviter d'accumuler les anciens chunks hashes de Vite.
- Le service `hexagram-api` lit `HEXAGRAM_JWT_SECRET` depuis `/opt/hexagram/server/.env`.
  Le secret est genere automatiquement au premier deploy s'il est absent.
