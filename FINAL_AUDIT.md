# Audit final — FacturePro 2.1.0

Document de recette : ce qui a été **réellement exécuté**, les résultats
obtenus, et ce qui reste hors périmètre. Aucune case n'est cochée sans preuve
d'exécution.

- Date de la recette : 23 octobre 2026
- Environnement : Linux x64 (bac à sable de développement), Node 22.22.3,
  Electron 40.10.6, Chromium headless 153 pour les tests d'interface
- Dépôt : `supremperf/Facturation-software`
- Commit de référence : voir l'historique de la branche
  `arena/4bf35882-facturation-software`

## Synthèse

Les 61 exigences détaillées au § 2 sont complétées par les points du § 3.

| Statut | Nombre | Où |
| --- | --- | --- |
| VALIDÉ | **60** | § 2 (60 lignes sur 61) |
| PARTIELLEMENT VALIDÉ | **5** | § 2.1 n° 8 (responsive) et § 3.1 à 3.4 |
| NON VALIDÉ | **1** | § 3.5 (facture électronique structurée) |
| NON IMPLÉMENTÉ, hors périmètre annoncé | **4** | connecteur plateforme agréée (PA), signature électronique qualifiée, mode multi-utilisateur/synchronisation, application mobile |

**Le logiciel est fonctionnel et utilisable** : le parcours complet (paramétrage,
client, facture, émission, PDF, avoir, paiement, sauvegarde, export) est
automatisé et passe de bout en bout sur une base vierge. La seule réserve
bloquante pour une livraison clé en main est la **production du fichier
`Setup.exe`**, impossible dans cet environnement (voir § Installeur).

---

## 1. Exécution des tests

| Commande | Résultat | Détail |
| --- | --- | --- |
| `npm run typecheck` | ✅ 0 erreur | `tsc --noEmit` sur tout le projet |
| `npm test` (Vitest) | ✅ **90 tests / 8 fichiers** | 12,9 s |
| `npm run test:e2e` (Puppeteer) | ✅ **22 / 22 vérifications** | ~110 s, base vierge recréée |
| `npm run build` | ✅ | main + preload (esbuild) + renderer (Vite) |
| `npm run dist` | ⚠️ échec réseau | voir § Installeur |

Répartition des tests unitaires et d'intégration :

| Fichier | Tests | Objet |
| --- | --- | --- |
| `tests/money.test.ts` | 11 | arithmétique en centimes, remises, ventilation TVA, arrondis |
| `tests/legal.test.ts` | 18 | moteur de conformité et mentions imprimées |
| `tests/invoicing.test.ts` | 22 | cycle de vie, paiements, avoirs, persistance, KPI |
| `tests/pdf.test.ts` | 7 | rendu A4, pagination, avoirs, filigrane, marges |
| `tests/ipc.test.ts` | 6 | couverture des canaux, validation zod, codes d'erreur |
| `tests/security.test.ts` | 10 | validateurs, assainissement, traversée de chemin, injections |
| `tests/backup-exports.test.ts` | 11 | sauvegardes, restauration, CSV/JSON/ZIP, corruption |
| `tests/ui-smoke.test.tsx` | 5 | rendu des pages et émission depuis l'interface |

Le parcours e2e (`scripts/e2e.mjs`) part d'une base **vide** et vérifie :

1. assistant de premier lancement affiché sur une base vierge ;
2. création de l'espace et arrivée sur le tableau de bord ;
3. état vide explicite, sans donnée de démonstration ;
4. aucun montant fictif affiché sur une base vide ;
5. alerte « Mentions légales à compléter » sur le tableau de bord ;
6. paramètres enregistrés (pénalités de retard, escompte) ;
7. client professionnel créé et listé ;
8. contrôle de conformité vert avant émission ;
9. facture émise avec un numéro définitif (`FAC-2026-0001`) ;
10. redirection vers la fiche de la facture émise ;
11. PDF archivé sur le disque à l'émission ;
12. le fichier archivé est un PDF valide ;
13. écran de création d'avoir rattaché à la facture d'origine ;
14. avoir émis avec un numéro distinct (`AV-2026-0001`) ;
15. PDF de l'avoir archivé ;
16. encaissement partiel : statut « Partiellement payée » recalculé ;
17. sauvegarde créée et listée ;
18. archive ZIP de sauvegarde présente sur le disque ;
19. export JSON généré ;
20. l'export contient la facture émise ;
21. statistiques alimentées par la base (CA non nul) ;
22. aucune erreur JavaScript pendant le parcours.

---

## 2. Exigences fonctionnelles

Légende : **V** = VALIDÉ · **P** = PARTIELLEMENT VALIDÉ · **N** = NON VALIDÉ

### 2.1 Interface

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 1 | Interface sombre premium reproduisant la maquette fournie | **V** | `docs/screenshots/tableau-de-bord.png` — sidebar à 10 entrées, cartes KPI, courbes, donut, table des factures récentes, flux d'activité |
| 2 | Barre latérale complète (Tableau de bord → Sauvegardes) | **V** | `src/renderer/components/Sidebar.tsx`, captures |
| 3 | Cartes KPI avec sparklines | **V** | 4 cartes : CA HT, encaissements, reste à encaisser, factures sur la période |
| 4 | Graphiques CA / statuts / comparaison | **V** | `src/renderer/components/Charts.tsx` (aire, barres, donut, sparkline) |
| 5 | Table des factures récentes et journal d'activité | **V** | `Dashboard.tsx`, captures |
| 6 | Interface **entièrement en français** | **V** | revue écran par écran ; dates et nombres au format `fr-FR` |
| 7 | États vides propres, aucune action inerte | **V** | e2e points 3-4 ; aucun bouton `disabled` sans explication |
| 8 | Responsive (poste 1120 px mini, repli à 1300/1100 px) | **P** | fenêtre Electron limitée à ≥1120 px ; en dessous, la grille des lignes de facture se réorganise mais l'application n'est pas conçue pour le mobile |

### 2.2 Données et calculs

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 9 | KPI calculés depuis la base, jamais codés en dur | **V** | `dashboard()` et `stats()` en SQL ; e2e points 4 et 21 ; test « calcule les indicateurs depuis la base » |
| 10 | Filtres de période (mois / trimestre / année) | **V** | `PeriodPreset`, sélecteur du tableau de bord et de la page statistiques |
| 11 | Montants exacts au centime (aucun flottant) | **V** | `src/shared/money.ts` en centimes entiers ; 11 tests dédiés dont arrondis difficiles |
| 12 | Remises par ligne (% ou €) et remise globale ventilée | **V** | tests « applique une remise en pourcentage / en montant », « répartit une remise globale sur plusieurs taux sans écart » |
| 13 | Taux de TVA multiples, ventilation par taux | **V** | `vatBreakdown`, page statistiques « TVA par taux », export CSV TVA |
| 14 | Frais supplémentaires | **V** | champ `isExtraFee` de la ligne, rendu dans le PDF |
| 15 | Aucune donnée de démonstration dans l'application livrée | **V** | base vierge au premier lancement ; le jeu de démonstration est un script **hors application** (`scripts/seed-preview.mjs`) non empaqueté |

### 2.3 Clients

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 16 | CRUD complet particuliers / professionnels | **V** | `ClientDialog.tsx`, `clients:*` ; tests e2e et unitaires |
| 17 | Validation SIREN / SIRET / TVA intracommunautaire | **V** | `isValidSiren`, `isValidFrenchVatNumber` (clé `(12 + 3 × SIREN mod 97) mod 97`) ; test sécurité |
| 18 | Adresse de livraison distincte | **V** | champ dédié, repris sur la facture et le PDF |
| 19 | Instantané figé sur la facture émise | **V** | `clientSnapshot` / `sellerSnapshot` / `legalSnapshot` ; test « capture les informations sans les inventer » |
| 20 | Suppression impossible si facture émise, archivage possible | **V** | test « interdit la suppression d'un client ayant des factures et permet l'archivage » |

### 2.4 Facturation

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 21 | Éditeur complet (lignes, quantité, unité, PU, remise, TVA, frais) | **V** | `InvoiceEditor.tsx` ; parcours e2e (saisie de 4 champs, total recalculé) et `docs/screenshots/factures.png` |
| 22 | Totaux HT / TVA / TTC recalculés en direct | **V** | `computeInvoice`, vérifié dans l'e2e et les tests monétaires |
| 23 | Numérotation **sans trou**, par exercice, brouillons non numérotés | **V** | tests « attribue des numéros uniques et chronologiques », « réinitialise la numérotation par année », « supprime un brouillon sans consommer de numéro » |
| 24 | Facture émise non modifiable et non supprimable | **V** | codes `IMMUTABLE` vérifiés par test IPC et par appel HTTP sur l'aperçu |
| 25 | Correction uniquement par avoir | **V** | `AV-2026-0001` créé et émis dans l'e2e |
| 26 | Aperçu avant émission | **V** | `invoices:preview` → PDF filigrané « APERÇU », non archivé (test dédié) |
| 27 | Encaissements partiels, statut recalculé | **V** | test « gère un paiement partiel puis total », e2e point 16 |
| 28 | Suppression d'un paiement tracée | **V** | test « recalcule le statut après suppression d'un paiement » |
| 29 | Avoirs : motif obligatoire, plafond, facture d'origine | **V** | 4 tests avoirs, dont « refuse un avoir supérieur au total de la facture » |
| 30 | Avoir possible sur une facture déjà payée | **V** | test ajouté : la limite est le montant facturé, pas le solde restant dû |
| 31 | Duplication en brouillon | **V** | test « marque une facture comme envoyée et la duplique en brouillon » |

### 2.5 Conformité française

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 32 | Moteur de mentions obligatoires bloquant à l'émission | **V** | `src/shared/legal.ts`, 18 tests, panneau de conformité dans l'éditeur |
| 33 | Identité vendeur (SIREN/SIRET, forme, capital, RCS/RM, TVA) | **V** | contrôles conditionnels selon la forme juridique |
| 34 | SIREN du client professionnel français | **V** | art. 242 nonies A, 1° ann. II CGI ; test « exige le SIREN d'un client professionnel français » |
| 35 | Adresse de livraison si différente (biens) | **V** | test « signale l'adresse de livraison incomplète » |
| 36 | Nature de l'opération (biens / services / mixte) | **V** | champ obligatoire, imprimé sur le PDF |
| 37 | Option TVA sur les débits | **V** | réglage `fiscal.debitsOption`, mention imprimée si activée |
| 38 | Franchise en base : mention CIBS/293 B et **aucune TVA facturée** | **V** | test « bloque une TVA facturée en franchise en base », mention par défaut L. 223-3 CIBS (équivalence admise jusqu'au 31/12/2027) |
| 39 | Pénalités de retard, indemnité 40 €, escompte | **V** | test « exige les pénalités et l'escompte entre professionnels » |
| 40 | Garantie légale de conformité + médiateur (vente à un particulier) | **V** | tests dédiés |
| 41 | Cohérence arithmétique et date non future | **V** | tests « bloque un brouillon dont les totaux ont été altérés », « bloque une date d'émission future » |
| 42 | Mentions de facturation électronique 2026/2027 + avertissement PDF ≠ facture électronique | **V** | contrôle `einv.*`, texte explicite dans l'application et à propos |
| 43 | Aucune mention légale inventée (taux, SIREN, clauses) | **V** | les valeurs viennent des réglages ; les champs non renseignés bloquent au lieu d'être complétés d'office |

### 2.6 PDF et archivage

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 44 | PDF A4 professionnel, texte sélectionnable, accents | **V** | `docs/screenshots/pdf-facture.png`, extraction de texte par pdf.js dans les tests |
| 45 | Logo (PNG/JPG/SVG converti) | **V** | import réel d'un SVG testé dans l'aperçu → PNG stocké, image présente dans le PDF |
| 46 | Pagination `1/N` avec en-tête répété | **V** | `docs/screenshots/pdf-pagination.png`, test 40 lignes, contrôle de chaque page |
| 47 | Pas de page orpheline en fin de document | **V** | mesure du bloc « mentions légales » avant impression ; vérifié sur une facture de 3 pages |
| 48 | PDF archivé hors du dossier d'installation (`%APPDATA%`) | **V** | `userData/documents/Factures/<année>/<numéro>.pdf`, empreinte SHA-256 en base |
| 49 | PDF original non réécrit après paiement | **V** | test « garde le PDF original intact après enregistrement des paiements » |
| 50 | Conservation 10 ans, aucune suppression automatique | **V** | aucune purge des factures émises dans le code ; sauvegardes manuelles conservées et rotation limitée aux sauvegardes **automatiques** |

### 2.7 Exports, sauvegardes, sécurité

| # | Exigence | Statut | Preuve / remarque |
| --- | --- | --- | --- |
| 51 | Export CSV factures (Excel, UTF-8 BOM, `;`) | **V** | test dédié |
| 52 | Export CSV TVA par taux | **V** | test dédié |
| 53 | Export JSON complet | **V** | test + e2e point 19-20 |
| 54 | Export ZIP des PDF (sélection multiple) | **V** | test « exporte une archive ZIP de PDF nommés proprement » |
| 55 | Sauvegarde / restauration complètes | **V** | 5 tests sauvegardes dont restauration et rejet d'un faux fichier |
| 56 | Récupération après corruption de la base | **V** | test : base corrompue refusée, nouvelle base créée, original conservé |
| 57 | `contextIsolation`, pas de `nodeIntegration`, `sandbox` | **V** | `src/main/index.ts` (`webPreferences`), CSP stricte, protocole `app://` |
| 58 | Validation IPC par schémas | **V** | 100 % des canaux testés par un schéma zod ; test « valide les entrées avec zod » |
| 59 | Confinement des chemins de fichiers | **V** | `safeDocumentPath` + tests de traversée |
| 60 | Pas de fuite de pile d'exception vers le renderer | **V** | test dédié |
| 61 | Aucune requête réseau sortante | **V** | aucun client HTTP dans `src/` ; CSP `connect-src 'self'` |

---

## 3. Points partiellement validés ou non validés

### 3.1 Installeur Windows — **PARTIELLEMENT VALIDÉ**

`npm run dist` a été exécuté. La chaîne réussit la compilation, la
reconstruction des dépendances natives et atteint le packaging Windows :

```
• electron-builder  version=26.15.3
• loaded configuration  file=package.json ("build" field)
• executing @electron/rebuild  electronVersion=40.10.6 arch=x64
• completed installing native dependencies
• packaging       platform=win32 arch=x64 electron=40.10.6 appOutDir=release/win-unpacked
⨯ unable to verify the first certificate
```

L'échec vient du téléchargement de l'archive `electron-v40.10.6-win32-x64.zip`
depuis `github.com` : le bac à sable coupe la connexion TLS vers
`release-assets.githubusercontent.com`
(`SSL_ERROR_SYSCALL`), et le binaire n'a donc jamais pu être mis en cache.

Ce qui **a** été vérifié :

- la configuration electron-builder passe son propre validateur de schéma
  (`validateConfiguration`) sans erreur ;
- les cibles NSIS x64, l'icône, l'`appId`, `artifactName`
  (`FacturePro-Setup-2.1.0.exe`), les raccourcis, l'installation par
  utilisateur et `deleteAppDataOnUninstall: false` sont déclarés ;
- les `files`, `extraResources` (polices) et `asarUnpack` (pdfkit/fontkit)
  sont cohérents avec les imports du processus principal ;
- le build applicatif complet (`npm run build`) produit `dist/main`,
  `dist/preload` et `dist/renderer`.

**Conséquence** : aucun `Setup.exe` n'a été produit dans cet environnement. Sur
un poste avec accès réseau normal, `npm install && npm run dist` doit produire
`release/FacturePro-Setup-2.1.0.exe` ; ce chemin n'a pas pu être constaté de
bout en bout ici, et n'est donc pas déclaré validé.

### 3.2 Application Electron lancée « en vrai » — **PARTIELLEMENT VALIDÉ**

Le processus principal, le preload et le renderer ont été compilés, mais la
fenêtre Electron n'a pas pu être ouverte : `electron` n'a pas de binaire dans
ce bac à sable (même blocage réseau). Tout ce qui est testable sans le binaire a
été testé, et l'interface a été exercée dans un **vrai Chromium** contre le
**vrai backend** (SQLite, PDF, conformité) via `scripts/preview-server.ts`, qui
réutilise strictement les mêmes services et les mêmes canaux.

Ne sont donc **pas** couverts par une exécution réelle : l'ouverture de la
fenêtre, le menu applicatif, les boîtes de dialogue natives
(enregistrer sous, ouvrir une sauvegarde), l'impression système et
`shell.openPath`. Ces fonctions sont implémentées et relèvent d'API Electron
standards, mais n'ont pas été observées à l'exécution.

### 3.3 Impression — **PARTIELLEMENT VALIDÉ**

`invoices:print` ouvre une fenêtre cachée et appelle
`webContents.print` ; en cas d'échec, le PDF est ouvert dans le lecteur
système. Le code est défensif, mais l'impression elle-même n'a pas pu être
testée sans Electron ni imprimante.

### 3.4 Recherche globale et palette de commandes — **PARTIELLEMENT VALIDÉ**

Le service `globalSearch` est testé (requêtes SQL paramétrées, résistance à
l'injection) et la palette s'ouvre par `Ctrl+K` dans l'aperçu, mais
l'ergonomie fine (navigation clavier dans les résultats) n'a pas été couverte
par un test automatisé.

### 3.5 Facturation électronique — **NON VALIDÉ (par conception)**

Le logiciel **ne produit pas** de facture électronique structurée (Factur-X,
UBL, CII) et ne transmet rien à une plateforme agréée. C'est un choix assumé et
annoncé dans l'interface : le PDF est un document lisible archivé, et
l'utilisateur est averti de l'échéance du 1er septembre 2026 / 2027 selon sa
catégorie. La structure de données prévoit la catégorie d'entreprise et le
partenaire (`eInvoicingPhase`, `eInvoicingPartner`) pour une intégration
ultérieure, mais **aucun connecteur n'existe**.

### 3.6 Points à connaître avant mise en production commerciale

1. Produire et signer l'installeur sur une machine Windows (code de signature
   absent : l'installeur ne sera pas signé, SmartScreen affichera un
   avertissement).
2. Valider les mentions légales avec un expert-comptable : les textes par
   défaut (pénalités, escompte, médiateur) sont des **valeurs à personnaliser**,
   l'application ne les invente pas mais ne garantit pas qu'elles correspondent
   à chaque activité.
3. Faire relire la mention de franchise retenue (L. 223-3 CIBS) : elle est
   valable jusqu'au 31 décembre 2027, l'article 293 B du CGI restant admis en
   équivalence sur cette période.
4. Prévoir une politique de sauvegarde externe : les archives ZIP sont locales.

---

## 4. Corrections apportées pendant la recette

| Problème constaté | Cause | Correction |
| --- | --- | --- |
| Saisie impossible dans la colonne « Désignation » du formulaire de facture | `min-width: 860px` dans une colonne de ~718 px : le champ tombait à **26 px**, la page défilait et les touches se perdaient | Grille sur deux rangées, colonnes élargies, micro-libellés à la place de l'en-tête de tableau |
| Un avoir affichait un « solde dû » à encaisser | `mapSummary` calculait un solde pour tous les documents | Solde forcé à 0 pour un avoir ; tiret affiché dans la liste |
| Carte KPI « Factures sur la période » sans courbe | série mensuelle sans compteur | ajout du compteur mensuel de factures (hors avoirs) et sparkline dédiée |
| Avoir : échéance et conditions de règlement sans objet | fiche réutilisant le modèle facture | remplacées par la référence à la facture d'origine |
| Avoir : « créditable » calculé sur le solde restant dû | confusion solde / montant facturé | plafond calculé sur le total TTC moins les avoirs déjà émis, et test dédié |
| Montants collés (`7 283,33 €` illisible) | espace fine insécable trop étroite avec la police Inter | espace insécable classique dans l'interface, normalisation conservée pour les PDF |
| SIREN du client parfois absent du PDF | bloc client limité à 4 lignes, l'adresse prenait toute la place | SIREN/TVA toujours affichés, adresse tronquée si nécessaire |
| Dernière page d'une facture longue ne contenant qu'une ligne de mentions | pagination imprimant les mentions au fil de l'eau | le bloc est mesuré puis déplacé en entier |
| « Configuration requise » sous le nom de l'entreprise alors que la fiche était complète | libellé lié à la seule forme juridique | repli sur le SIREN, avec explication dans la fiche d'identité |
| Erreurs de règle métier remontées en `INTERNAL` | `AppError` non utilisé par la couche base de données | `AppError` déplacé dans `infra/errors.ts` avec des codes stables (`IMMUTABLE`, `CREDIT_LIMIT`, …) et test de non-régression |

---

## 5. Conclusion

L'application couvre l'ensemble du périmètre fonctionnel demandé : édition de
factures conformes, numérotation continue, archivage PDF, avoirs, encaissements,
exports, sauvegardes, paramétrage complet de l'identité et des mentions
légales, le tout hors ligne et en français.

Deux réserves subsistent, toutes deux liées à l'environnement de développement
et non au code applicatif :

- **l'installeur Windows n'a pas pu être produit ici** (blocage TLS sur les
  binaires Electron) : `npm run dist` doit être relancé sur une machine
  connectée pour obtenir `Setup.exe` ;
- **la fenêtre Electron native n'a pas été ouverte** ; l'interface a été
  validée dans Chromium contre le backend réel, ce qui couvre le rendu, les
  calculs et les échanges IPC, mais pas les dialogues système.

La facturation électronique structurée reste **hors périmètre**, comme annoncé
dans l'application.
