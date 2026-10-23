# FacturePro — logiciel de facturation français, hors ligne

Application de bureau (Electron + React + TypeScript + SQLite via sql.js) pour
éditer des factures conformes au droit français, suivre les encaissements,
émettre des avoirs et archiver les PDF — **sans cloud, sans compte, sans
données envoyées à l'extérieur**.

![Tableau de bord](docs/screenshots/tableau-de-bord.png)

---

## Démarrage

```bash
npm install
npm run dist          # → release/FacturePro-Setup-2.1.0.exe (NSIS, Windows x64)
```

Autres commandes :

| Commande | Effet |
| --- | --- |
| `npm run dev` | Vite + Electron avec rechargement à chaud |
| `npm run build` | Vérification TypeScript + compilation du main, du preload et du renderer |
| `npm start` | Compile puis lance l'application Electron |
| `npm test` | Tests unitaires et d'intégration (Vitest) |
| `npm run test:e2e` | Parcours complet dans un vrai Chromium (Puppeteer) |
| `npm run preview` | Serveur d'aperçu navigateur servant le **vrai** backend |
| `npm run pack` | Dossier décompressé (`release/win-unpacked`) sans installeur |
| `npm run shots` | Captures d'écran de documentation (serveur d'aperçu requis) |
| `npm run pdf:render -- <fichier.pdf>` | Rastérise un PDF en PNG pour contrôler le rendu A4 |
| `npm run seed:preview` | Jeu de démonstration **hors application** pour l'aperçu web |

> **Note sur l'environnement de développement de cette session** : le binaire
> Electron et les outils NSIS sont téléchargés par `npm install` /
> `npm run dist` depuis `github.com`. Le bac à sable utilisé pour développer
> bloque `release-assets.githubusercontent.com` (SSL), donc `Setup.exe` n'a pas
> pu être produit ici — la configuration electron-builder a toutefois été
> validée par son propre schéma (`validateConfiguration`) et le pipeline
> atteint l'étape de packaging Windows. Voir `FINAL_AUDIT.md`.

## Ce que fait l'application

### Facturation

- **Brouillons sans numéro** puis **numérotation définitive à l'émission**,
  continue par exercice, sans trou (compteur transactionnel en base).
- **Éditeur complet** : lignes multiples, quantité décimale, unité, remise par
  ligne (pourcentage ou montant), taux de TVA, frais supplémentaires, remise
  globale, arrondis au centime par ventilation exacte des taux.
- **Facture émise figée** : ni modification ni suppression ; toute correction
  passe par un **avoir** rattaché à la facture d'origine, avec motif et
  traçabilité.
- **Avoirs** numérotés séparément (`AV-…`), limités au montant facturé.
- **Aperçu avant émission** avec filigrane « APERÇU », puis **PDF A4 archivé**
  à l'émission (logo, pagination 1/N, texte sélectionnable, accents corrects).
- **Paiements** partiels ou complets, statut recalculé
  (émise / partiellement payée / payée / en retard), suppression tracée.

### Conformité française

Le moteur de conformité (`src/shared/legal.ts`) vérifie, **avant toute
émission**, les mentions obligatoires et **bloque** l'émission si l'une
manque :

- identité complète du vendeur (dénomination, SIREN/SIRET validés, adresse,
  forme juridique, capital social quand la forme l'exige, RCS/RM selon le cas,
  TVA intracommunautaire) ;
- identité et adresse du client, **SIREN du client** pour un professionnel
  établi en France (art. 242 nonies A, 1° ann. II CGI) ;
- **adresse de livraison** lorsqu'elle diffère et que l'opération porte sur des
  biens, **nature de l'opération** (biens / services / mixte) et **option TVA
  sur les débits** ;
- dates (émission, réalisation, échéance), conditions et mode de règlement,
  **pénalités de retard**, **indemnité forfaitaire de 40 €**, **escompte** ;
- **franchise en base** : la mention configurée est reprise telle quelle (par
  défaut la référence CIBS « TVA non applicable, art. L. 223-3 du code des
  impositions sur les biens et services », l'équivalence avec l'article 293 B du
  CGI étant admise jusqu'au 31 décembre 2027) et **aucune TVA ne peut être
  facturée** dans ce régime ;
- garantie légale de conformité et médiateur pour une vente de biens à un
  particulier ;
- cohérence arithmétique des totaux, numéro unique, date non postérieure à
  aujourd'hui.

Le rapport est visible dans l'éditeur (panneau « Conformité »), chaque anomalie
renvoyant à l'écran où la corriger.

**Facturation électronique** : l'application affiche le calendrier
(1er septembre 2026 pour la réception et les grandes entreprises, 1er septembre
2027 pour les PME/TPE) et précise explicitement que **le PDF produit n'est pas
une facture électronique structurée** et ne remplace pas une transmission via
plateforme agréée. Le réglage `eInvoicingPhase` prépare une intégration PA
future ; aucune connexion réseau n'est effectuée.

### Gestion

- **Clients** : particuliers et professionnels, SIREN/SIRET/TVA validés
  (clé de contrôle), adresse de livraison distincte, archivage (suppression
  impossible dès qu'une facture émise existe), instantané figé sur la facture.
- **Tableau de bord** : KPI calculés en SQL (CA HT/TTC, encaissements, reste à
  encaisser, nombre de factures), filtres de période, courbes, répartition par
  statut, dernières factures, journal d'activité. Aucune donnée de
  démonstration.
- **Statistiques** et **Rapports** : activité mensuelle, TVA par taux,
  top clients, exports **CSV** (compatible Excel, UTF-8 BOM), **CSV TVA**,
  **JSON** complet et **ZIP** des PDF.
- **Sauvegardes** : archive ZIP (base + PDF + manifeste) créée à la demande,
  restauration, export/import, contrôle d'intégrité SQLite au démarrage et
  récupération non destructive en cas de corruption.

### Interface

Interface sombre entièrement en français, états vides explicites, recherche
globale (Ctrl+K), raccourcis, notifications locales, aucune action factice.
Captures : `docs/screenshots/` (régénérables avec `node scripts/shots.mjs`
pendant que `npm run preview` tourne).

## Données et sécurité

- Données dans `%APPDATA%\FacturePro\` (`data/`, `documents/`, `backups/`,
  `exports/`, `logs/`, `branding/`), jamais dans le dossier d'installation :
  une mise à jour de l'application ne touche pas aux factures.
- Base SQLite unique, écritures transactionnelles, séquence de numérotation
  atomique.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`, navigation restreinte au protocole `app://`, CSP stricte.
- Chaque canal IPC est déclaré une seule fois, validé par un schéma **zod**, et
  les chemins de fichiers sont confinés au dossier de données (`safeDocumentPath`).
- Les erreurs métier remontent un code et un message ; les piles d'exception ne
  franchissent jamais l'IPC.
- Conservation : les factures émises ne sont jamais supprimées automatiquement ;
  l'utilisateur est invité à sauvegarder (conservation légale de 10 ans).

## Architecture

```
src/
  main/        processus principal Electron
    db/        schéma SQLite, mappings, dépôts (requêtes SQL)
    services/  logique métier : émission, paiements, avoirs, exports, sauvegardes
    pdf/       rendu A4 avec pdfkit
    ipc/       déclaration des canaux, schémas zod, garde-fous
    infra/     chemins, journalisation
  preload/     pont `contextBridge` typé, sans accès Node pour le renderer
  renderer/    React 19 + React Router, styles CSS maison
  shared/      calculs monétaires, moteur de conformité, dates, types, IPC
scripts/       builds (esbuild/Vite), serveur d'aperçu, e2e, captures
tests/         Vitest (calculs, conformité, PDF, IPC, sécurité, exports, UI)
```

Les montants sont manipulés en **centimes entiers** (`src/shared/money.ts`),
jamais en flottants ; les remises globales sont réparties au prorata avec
correction du dernier centime pour que la somme des lignes égale le total.

## Tests

```bash
npm test        # 90 tests, 8 fichiers
npm run test:e2e  # 22 vérifications de bout en bout
```

Le parcours e2e part d'une base vierge : assistant de premier lancement,
paramétrage des mentions légales, création d'un client, rédaction d'une
facture, contrôle de conformité, émission (numéro + PDF réel sur disque),
avoir rattaché et émis, encaissement partiel, sauvegarde, export JSON,
statistiques, et vérifie qu'aucune erreur JavaScript n'est survenue.

## Limites assumées

- Pas de facture électronique structurée (Factur-X/UBL/CII) ni de connexion à
  une plateforme agréée : le PDF est un document lisible archivé.
- Pas de multi-utilisateur ni de synchronisation : mono-poste, hors ligne.
- Pas de signature électronique ni d'horodatage qualifié.
- L'installeur Windows doit être produit sur une machine disposant d'un accès
  réseau normal (voir la note ci-dessus).
