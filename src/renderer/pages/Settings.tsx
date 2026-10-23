import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  FileCog,
  FolderOpen,
  Info,
  Landmark,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type { AppSettings, EInvoicingPhase, PaymentMethod, PdfTemplate } from '@shared/types';
import {
  E_INVOICING_PHASE_LABEL,
  E_INVOICING_PHASE_START,
  PAYMENT_METHODS,
  UNITS,
} from '@shared/constants';
import { formatDateFR } from '@shared/dates';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { euro, humanFileSize, numberFR } from '../lib/format';
import { Link } from '../lib/router';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  Field,
  InlineError,
  LoadingBlock,
  PageHeader,
  PercentInput,
  Select,
  Switch,
  TextInput,
  Textarea,
} from '../components/ui';

export function SettingsPage() {
  const toast = useToast();
  const { settings, appInfo, refreshSettings, bumpData } = useAppData();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings));
  }, [settings]);

  useEffect(() => {
    api.invoices
      .numberPreview('invoice')
      .then((result) => setPreview(result.nextNumber))
      .catch(() => setPreview(null));
  }, [settings]);

  if (!draft) return <div className="page"><LoadingBlock label="Chargement des paramètres…" /></div>;

  const patch = (updater: (current: AppSettings) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      updater(next);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.settings.save(draft);
      setDraft(structuredClone(saved));
      await refreshSettings();
      bumpData();
      toast.success('Paramètres enregistrés');
      api.invoices.numberPreview('invoice').then((result) => setPreview(result.nextNumber)).catch(() => undefined);
    } catch (reason) {
      setError(errorMessage(reason));
      toast.error('Enregistrement impossible', errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const vatRates = draft.fiscal.regime === 'normal'
    ? draft.fiscal.vatRates
    : [0];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Paramètres"
        subtitle="Numérotation, valeurs par défaut et mentions légales. L'identité complète se règle dans un écran dédié."
        actions={
          <Button icon={<Save size={15} />} loading={saving} onClick={save}>
            Enregistrer les paramètres
          </Button>
        }
      />

      {error ? <InlineError message={error} /> : null}

      <div className="settings-layout">
        <div className="settings-main">
          <Card>
            <CardHeader
              title="Numérotation des documents"
              subtitle="Séquence continue par exercice et par type de document"
              icon={FileCog}
            />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Préfixe des factures" hint="Lettres et chiffres, sans espace.">
                  <TextInput
                    value={draft.documents.invoicePrefix}
                    maxLength={10}
                    onChange={(event) => patch((next) => { next.documents.invoicePrefix = event.target.value.toUpperCase(); })}
                  />
                </Field>
                <Field label="Préfixe des avoirs">
                  <TextInput
                    value={draft.documents.creditPrefix}
                    maxLength={10}
                    onChange={(event) => patch((next) => { next.documents.creditPrefix = event.target.value.toUpperCase(); })}
                  />
                </Field>
                <Field label="Nombre de chiffres" hint="Entre 2 et 8. Exemple : 4 → 0001.">
                  <TextInput
                    type="number"
                    min={2}
                    max={8}
                    value={draft.documents.padding}
                    onChange={(event) => patch((next) => { next.documents.padding = Math.max(2, Math.min(8, Number(event.target.value) || 4)); })}
                  />
                </Field>
                <Field label="Premier numéro (optionnel)" hint="Laisser vide pour démarrer à 1.">
                  <TextInput
                    type="number"
                    min={1}
                    value={draft.documents.startNumber ?? ''}
                    onChange={(event) => patch((next) => { next.documents.startNumber = event.target.value ? Number(event.target.value) : null; })}
                  />
                </Field>
              </div>
              <Switch
                checked={draft.documents.resetYearly}
                onChange={(value) => patch((next) => { next.documents.resetYearly = value; })}
                label="Réinitialiser la séquence chaque année"
                hint="Recommandé : la numérotation repart à 1 au 1er janvier, avec l'année dans le numéro."
              />
              <div className="next-number-box">
                <span>Prochain numéro de facture</span>
                <strong>{preview ?? '—'}</strong>
                <p>
                  Format : {draft.documents.invoicePrefix || 'FAC'}-{new Date().getFullYear()}-
                  {'0'.repeat(Math.max(0, draft.documents.padding - 1))}1
                </p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Valeurs par défaut" subtitle="Pré-remplissage des nouveaux documents" icon={FileCog} />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Délai de paiement (jours)">
                  <TextInput
                    type="number"
                    min={0}
                    max={365}
                    value={draft.documents.defaultTermsDays ?? ''}
                    onChange={(event) => patch((next) => { next.documents.defaultTermsDays = event.target.value ? Number(event.target.value) : null; })}
                  />
                </Field>
                <Field label="Moyen de paiement">
                  <Select
                    value={draft.documents.defaultPaymentMethod}
                    onChange={(event) => patch((next) => { next.documents.defaultPaymentMethod = event.target.value as PaymentMethod; })}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Taux de TVA par défaut" hint={draft.fiscal.regime === 'franchise' ? 'Franchise en base : 0 % uniquement.' : 'Taux applicables configurés.'}>
                  <Select
                    value={String(draft.documents.defaultVatRateBp ?? 0)}
                    disabled={draft.fiscal.regime === 'franchise'}
                    onChange={(event) => patch((next) => { next.documents.defaultVatRateBp = Number(event.target.value); })}
                  >
                    {vatRates.map((rate) => (
                      <option key={rate} value={rate}>
                        {(rate / 100).toLocaleString('fr-FR')} %
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Unité par défaut">
                  <Select
                    value={draft.documents.defaultUnit}
                    onChange={(event) => patch((next) => { next.documents.defaultUnit = event.target.value; })}
                  >
                    {UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Modèle de document" hint="Le modèle influe sur la mise en page du PDF.">
                  <Select
                    value={draft.documents.pdfTemplate}
                    onChange={(event) => patch((next) => { next.documents.pdfTemplate = event.target.value as PdfTemplate; })}
                  >
                    <option value="modern">Moderne</option>
                    <option value="classic">Classique</option>
                    <option value="minimal">Minimal</option>
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Mentions légales" subtitle="Imprimées sur chaque document" icon={ShieldCheck} />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Taux des pénalités de retard" hint="En pourcentage annuel. Laisser vide si non défini.">
                  <PercentInput
                    ariaLabel="Taux des pénalités de retard"
                    valueBp={draft.legal.latePenaltyRateBp ?? 0}
                    onChange={(value) => patch((next) => { next.legal.latePenaltyRateBp = value > 0 ? value : null; })}
                  />
                </Field>
                <Field label="Escompte pour paiement anticipé" hint="Exemple : « Aucun escompte accordé pour paiement anticipé. »">
                  <TextInput
                    aria-label="Escompte pour paiement anticipé"
                    value={draft.legal.escompte}
                    onChange={(event) => patch((next) => { next.legal.escompte = event.target.value; })}
                    maxLength={1000}
                  />
                </Field>
              </div>
              <Switch
                checked={draft.legal.recoveryIndemnity}
                onChange={(value) => patch((next) => { next.legal.recoveryIndemnity = value; })}
                label="Indemnité forfaitaire de recouvrement de 40 €"
                hint="Due de plein droit pour tout professionnel en retard de paiement (art. D. 441-5 du code de commerce)."
              />
              <Switch
                checked={draft.legal.enforceSirenForProClients}
                onChange={(value) => patch((next) => { next.legal.enforceSirenForProClients = value; })}
                label="Exiger le SIREN des clients professionnels établis en France"
                hint="Mention obligatoire depuis le décret n° 2022-1299. Le contrôle bloque l'émission si absent."
              />
              <div className="form-grid">
                <Field label="Médiateur de la consommation">
                  <TextInput
                    value={draft.legal.mediatorName}
                    onChange={(event) => patch((next) => { next.legal.mediatorName = event.target.value; })}
                    placeholder="Nom du médiateur"
                    maxLength={200}
                  />
                </Field>
                <Field label="Site du médiateur">
                  <TextInput
                    value={draft.legal.mediatorUrl}
                    onChange={(event) => patch((next) => { next.legal.mediatorUrl = event.target.value; })}
                    placeholder="https://…"
                    maxLength={300}
                  />
                </Field>
                <Field label="Adresse du médiateur" className="span-2">
                  <TextInput
                    value={draft.legal.mediatorAddress}
                    onChange={(event) => patch((next) => { next.legal.mediatorAddress = event.target.value; })}
                    maxLength={500}
                  />
                </Field>
                <Field label="Mention garantie légale (consommateurs)" className="span-2">
                  <Textarea
                    value={draft.legal.consumerGoodsMention}
                    onChange={(event) => patch((next) => { next.legal.consumerGoodsMention = event.target.value; })}
                    rows={3}
                    maxLength={2000}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Facturation électronique" subtitle="Calendrier légal et préparation" icon={CalendarClock} />
            <div className="card-body">
              <div className="form-grid">
                <Field
                  label="Catégorie de l'entreprise"
                  hint="Détermine la date d'entrée en vigueur de l'obligation de réception."
                >
                  <Select
                    value={draft.legal.eInvoicingPhase}
                    onChange={(event) => patch((next) => { next.legal.eInvoicingPhase = event.target.value as EInvoicingPhase; })}
                  >
                    {Object.entries(E_INVOICING_PHASE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Plateforme agréée / partenaire" hint="Facultatif. Aucune intégration PA n'est encore active.">
                  <TextInput
                    value={draft.legal.eInvoicingPartner}
                    onChange={(event) => patch((next) => { next.legal.eInvoicingPartner = event.target.value; })}
                    placeholder="Nom de la plateforme"
                    maxLength={200}
                  />
                </Field>
              </div>
              <div className="einv-note">
                <Info size={16} />
                <div>
                  <strong>
                    {E_INVOICING_PHASE_START[draft.legal.eInvoicingPhase]
                      ? `Réception obligatoire à partir du ${formatDateFR(E_INVOICING_PHASE_START[draft.legal.eInvoicingPhase]!)}`
                      : 'Calendrier à renseigner'}
                  </strong>
                  <p>
                    Le PDF seul ne constitue pas une facture électronique au sens de la réforme. FacturePro prépare
                    l'architecture (mentions, SIREN client, nature d'opération) mais n'émet pas encore de facture
                    structurée via une plateforme agréée.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <aside className="settings-aside">
          <Card>
            <CardHeader title="Entreprise" subtitle="Identité, fiscalité et marque" icon={Building2} />
            <div className="card-body">
              <p className="settings-company">{draft.business.tradeName || draft.business.legalName || 'Identité à compléter'}</p>
              <p className="field-hint">
                {[draft.business.legalForm, draft.business.address.city].filter(Boolean).join(' · ') || 'Complétez votre fiche entreprise.'}
              </p>
              <Link to="/parametres/entreprise">
                <Button variant="secondary" block trailingIcon={<ArrowRight size={14} />}>
                  Modifier l'identité
                </Button>
              </Link>
              <div className="info-list">
                <div className="info-row">
                  <span>Régime TVA</span>
                  <strong>
                    {draft.fiscal.regime === 'normal'
                      ? 'Assujetti'
                      : draft.fiscal.regime === 'franchise'
                        ? 'Franchise en base'
                        : draft.fiscal.regime === 'exemption'
                          ? 'Exonéré'
                          : 'Non renseigné'}
                  </strong>
                </div>
                <div className="info-row">
                  <span>Coordonnées bancaires</span>
                  <strong>{draft.bank.iban ? 'Renseignées' : 'Absentes'}</strong>
                </div>
                <div className="info-row">
                  <span>Logo</span>
                  <strong>{draft.branding.logo ? 'Importé' : 'Aucun'}</strong>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Données & sécurité" subtitle="Stockage local" icon={ShieldCheck} />
            <div className="card-body">
              {appInfo ? (
                <div className="info-list">
                  <div className="info-row">
                    <span>Version</span>
                    <strong>{appInfo.version}</strong>
                  </div>
                  <div className="info-row">
                    <span>Base de données</span>
                    <strong>{humanFileSize(appInfo.databaseSize)}</strong>
                  </div>
                  <div className="info-row">
                    <span>Documents</span>
                    <strong>{numberFR(appInfo.documentCount)} · {humanFileSize(appInfo.documentsSize)}</strong>
                  </div>
                  <div className="info-row">
                    <span>Schéma</span>
                    <strong>v{appInfo.dbSchemaVersion}</strong>
                  </div>
                  <div className="info-row">
                    <span>Référentiel</span>
                    <strong>{appInfo.rulesVersion}</strong>
                  </div>
                </div>
              ) : null}
              <Button variant="ghost" size="sm" block icon={<FolderOpen size={14} />} onClick={() => void api.openDataFolder()}>
                Ouvrir le dossier de données
              </Button>
              <Link to="/sauvegardes">
                <Button variant="ghost" size="sm" block icon={<Landmark size={14} />}>
                  Gérer les sauvegardes
                </Button>
              </Link>
            </div>
          </Card>

          <div className="settings-hint">
            <Info size={15} />
            <p>
              Les paramètres n'affectent pas les documents déjà émis : chaque facture conserve la copie de vos
              mentions et de votre identité au moment de l'émission.
            </p>
          </div>
        </aside>
      </div>

      <div className="settings-footer">
        <span>{draft.documents.invoicePrefix}-{new Date().getFullYear()}-… · prochain numéro {preview ?? '—'}</span>
        <Button icon={<Save size={15} />} loading={saving} onClick={save}>
          Enregistrer les paramètres
        </Button>
      </div>
    </div>
  );
}
