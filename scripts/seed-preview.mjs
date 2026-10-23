/**
 * Jeu de données de DÉMONSTRATION pour le serveur d'aperçu et les captures
 * d'écran — jamais chargé par l'application installée (aucun code de
 * production ne l'importe, il n'est pas empaqueté par electron-builder).
 *
 * Le script passe par les mêmes canaux IPC que l'interface : il crée de vrais
 * clients, de vraies factures numérotées et de vrais encaissements dans la base
 * SQLite de l'aperçu. Objectif : disposer d'un historique lisible pour vérifier
 * l'affichage des graphiques et illustrer le README.
 *
 * Usage : npm run preview (dans un terminal) puis
 *         node scripts/seed-preview.mjs [port] [--reset]
 */
import path from 'node:path';

const port = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : process.env.PORT ?? '4173';
const base = `http://127.0.0.1:${port}/api/invoke`;

async function invoke(channel, payload = null) {
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel, payload }),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`${channel} : ${body.error?.message ?? 'échec'}`);
  return body.data;
}

const vatKey = (siren) => String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');

const CLIENTS = [
  {
    type: 'professionnel',
    civility: '',
    firstName: 'Camille',
    lastName: 'Reynaud',
    companyName: 'Maison Verdier',
    legalForm: 'SAS',
    siren: '552100554',
    siret: '55210055400012',
    vatNumber: `FR${vatKey('552100554')}552100554`,
    vatSubject: true,
    email: 'compta@maison-verdier.fr',
    phone: '03 88 12 45 67',
    address: { line1: '12 rue des Verriers', line2: '', postalCode: '67000', city: 'Strasbourg', country: 'France' },
    deliveryAddress: null,
    notes: '',
  },
  {
    type: 'particulier',
    civility: 'Madame',
    firstName: 'Claire',
    lastName: 'Dubois',
    companyName: '',
    legalForm: '',
    siren: '',
    siret: '',
    vatNumber: '',
    vatSubject: true,
    email: 'claire.dubois@example.fr',
    phone: '06 12 34 56 78',
    address: { line1: '5 quai Saint-Jean', line2: '', postalCode: '67000', city: 'Strasbourg', country: 'France' },
    deliveryAddress: null,
    notes: '',
  },
];

function line(designation, quantity, unitPriceCents, vatRateBp, unit = 'unité', description = '') {
  return {
    designation,
    description,
    reference: '',
    quantity,
    unit,
    unitPriceCents,
    discountType: 'none',
    discountValue: 0,
    vatRateBp,
    isExtraFee: false,
    operationNature: 'services',
  };
}

async function main() {
  const existing = await invoke('clients:list', {});
  const clients = [];
  for (const input of CLIENTS) {
    const key = input.companyName || `${input.firstName} ${input.lastName}`;
    const match = existing.find(
      (entry) => (entry.companyName || `${entry.firstName} ${entry.lastName}`) === key,
    );
    clients.push(match ?? (await invoke('clients:create', input)));
    if (match) console.log(`Client ${key} déjà présent, réutilisé.`);
  }

  const [maison, dubois] = clients;
  const martin =
    existing.find((entry) => entry.companyName === 'Société Martin') ??
    (await invoke('clients:list', {})).find((entry) => entry.companyName === 'Société Martin');
  if (!martin) {
    console.error('Client « Société Martin » absent : lancez d’abord le parcours e2e ou ajoutez ce client.');
    process.exitCode = 1;
    return;
  }

  const documents = [
    {
      client: maison,
      issueDate: '2026-02-10',
      dueDate: '2026-03-12',
      operationNature: 'services',
      description: 'Aménagement de la salle de réunion',
      lines: [
        line('Étude et conception d’aménagement', 2, 145_000, 2000, 'jour', 'Plans, choix des matériaux et suivi de chantier'),
        line('Fourniture et pose de mobilier acoustique', 1, 430_000, 2000, 'lot'),
      ],
      payment: { date: '2026-03-05', amountCents: 864_000, method: 'virement', reference: 'VIR-2026-0312' },
    },
    {
      client: dubois,
      issueDate: '2026-03-18',
      dueDate: '2026-04-17',
      operationNature: 'services',
      description: 'Rénovation complète de la cuisine',
      lines: [
        line('Dépose et évacuation de l’ancienne cuisine', 1, 98_000, 1000, 'forfait'),
        line('Pose d’une cuisine équipée', 1, 382_000, 1000, 'forfait', 'Meubles, plan de travail et électroménager fournis par le client'),
      ],
    },
    {
      client: maison,
      issueDate: '2026-05-25',
      dueDate: '2026-06-24',
      operationNature: 'mixed',
      description: 'Mobilier sur mesure pour l’accueil',
      lines: [
        line('Banque d’accueil en chêne massif', 1, 285_000, 2000, 'unité'),
        line('Livraison et installation sur site', 1, 35_000, 2000, 'forfait'),
      ],
      payment: { date: '2026-06-18', amountCents: 150_000, method: 'virement', reference: 'VIR-2026-0644' },
    },
    {
      client: martin,
      issueDate: '2026-07-02',
      dueDate: '2026-08-01',
      operationNature: 'services',
      description: 'Audit énergétique du siège',
      lines: [line('Audit énergétique et rapport de préconisations', 1, 180_000, 2000, 'forfait')],
      markSent: true,
    },
    {
      client: dubois,
      issueDate: '2026-09-30',
      dueDate: '2026-10-30',
      operationNature: 'services',
      description: 'Dressing sur mesure',
      lines: [
        line('Conception du dressing', 1, 60_000, 1000, 'forfait'),
        line('Fabrication et pose', 1, 200_000, 1000, 'forfait'),
      ],
    },
  ];

  for (const document of documents) {
    const draft = await invoke('invoices:save-draft', {
      clientId: document.client.id,
      issueDate: document.issueDate,
      dueDate: document.dueDate,
      serviceDate: document.issueDate,
      billingAddress: document.client.address,
      deliveryAddress: null,
      purchaseOrder: '',
      operationNature: document.operationNature,
      description: document.description,
      paymentTerms: 'Paiement à 30 jours date de facture.',
      paymentMethod: 'virement',
      notes: '',
      lines: document.lines,
      globalDiscountType: 'none',
      globalDiscountValue: 0,
    });
    const { invoice } = await invoke('invoices:issue', { id: draft.id });
    if (document.markSent) await invoke('invoices:mark-sent', { id: invoice.id });
    if (document.payment) {
      await invoke('payments:create', { invoiceId: invoice.id, note: '', ...document.payment });
    }
    console.log(`${invoice.number} · ${document.client.companyName || `${document.client.firstName} ${document.client.lastName}`} · ${(invoice.totals.totalTtcCents / 100).toFixed(2)} € TTC`);
  }

  // Un brouillon en cours de rédaction, pour montrer la numérotation différée.
  await invoke('invoices:save-draft', {
    clientId: maison.id,
    issueDate: '2026-10-23',
    dueDate: '2026-11-22',
    serviceDate: '2026-10-23',
    billingAddress: maison.address,
    deliveryAddress: null,
    purchaseOrder: '',
    operationNature: 'services',
    description: 'Projet de rénovation de la salle de bain',
    paymentTerms: 'Paiement à 30 jours date de facture.',
    paymentMethod: 'virement',
    notes: '',
    lines: [line('Rénovation de la salle de bain — estimation', 1, 420_000, 1000, 'forfait')],
    globalDiscountType: 'none',
    globalDiscountValue: 0,
  });

  const backup = await invoke('backups:create');
  const diagnostics = await invoke('app:diagnostics');
  console.log(`\nSauvegarde ${path.basename(backup.path ?? backup.name ?? 'créée')} · intégrité ${diagnostics.integrity}.`);
  console.log('Jeu de démonstration prêt.');
}

main().catch((error) => {
  console.error('Échec du jeu de démonstration :', error.message);
  process.exitCode = 1;
});
