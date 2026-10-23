import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ImagePlus,
  Landmark,
  Palette,
  Percent,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AppSettings, VatRegime } from '@shared/types';
import {
  COUNTRIES,
  FRANCHISE_MENTION_PRESETS,
  LEGAL_FORMS,
  LEGAL_STATUSES,
  VAT_REGIME_LABEL,
  VAT_RATE_PRESETS,
  companyDisplayName,
  formatAddressLines,
  requiresCapital,
  requiresRcs,
} from '@shared/constants';
import {
  isValidBic,
  isValidFrenchVatNumber,
  isValidIban,
  isValidSiren,
  isValidSiret,
} from '@shared/validators';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { formatPercentFromBp } from '../lib/format';
import { Link } from '../lib/router';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  Field,
  InlineError,
  LoadingBlock,
  MoneyInput,
  PageHeader,
  Segmented,
  Select,
  Switch,
  TextInput,
  Textarea,
} from '../components/ui';

export function CompanyIdentityPage() {
  const toast = useToast();
  const { settings, logoUrl, refreshSettings, bumpData, setupSkipped, skipSetup } = useAppData();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings));
  }, [settings]);

  const issues = useMemo(() => {
    if (!draft) return [] as string[];
    const list: string[] = [];
    if (!draft.business.legalName.trim() && !draft.business.tradeName.trim()) {
      list.push('Renseignez la raison sociale ou le nom commercial.');
    }
    if (!isValidSiren(draft.business.siren)) list.push('Le SIREN doit comporter 9 chiffres valides.');
    if (!draft.business.address.line1.trim() || !draft.business.address.city.trim()) {
      list.push('Complétez l’adresse du siège social.');
    }
    if (!draft.fiscal.regime) list.push('Sélectionnez votre régime de TVA.');
    if (draft.fiscal.regime === 'franchise' && !draft.fiscal.franchiseMention.trim()) {
      list.push('La mention de franchise en base est obligatoire.');
    }
    if (draft.business.vatNumber && !isValidFrenchVatNumber(draft.business.vatNumber)) {
      list.push('Le numéro de TVA intracommunautaire est invalide.');
    }
    if (draft.bank.iban && !isValidIban(draft.bank.iban)) list.push('L’IBAN est invalide.');
    if (draft.bank.bic && !isValidBic(draft.bank.bic)) list.push('Le BIC est invalide.');
    if (draft.legal.latePenaltyRateBp === null) {
      list.push('Renseignez le taux des pénalités de retard (factures entre professionnels).');
    }
    if (!draft.legal.escompte.trim()) {
      list.push('Indiquez les conditions d’escompte, même pour préciser qu’aucun escompte n’est accordé.');
    }
    return list;
  }, [draft]);

  const ready = issues.length === 0;

  if (!draft) {
    return (
      <div className="page">
        <LoadingBlock label="Chargement de votre identité…" height={420} />
      </div>
    );
  }

  const patch = (updater: (current: AppSettings) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      updater(next);
      return next;
    });
  };

  const save = async (completeSetup = false) => {
    setSaving(true);
    setError(null);
    try {
      const next: AppSettings = structuredClone(draft);
      if (completeSetup) next.setupCompleted = true;
      const saved = await api.settings.save(next);
      setDraft(structuredClone(saved));
      await refreshSettings();
      bumpData();
      toast.success('Identité enregistrée', completeSetup ? 'Votre espace est configuré.' : undefined);
      if (completeSetup) skipSetup();
    } catch (reason) {
      setError(errorMessage(reason));
      toast.error('Enregistrement impossible', errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const readImage = (file: File): Promise<{ base64: string; mime: string; fileName: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
      reader.onload = () => {
        const result = String(reader.result ?? '');
        if (file.type === 'image/svg+xml') {
          const image = new Image();
          image.onerror = () => reject(new Error('Le SVG est illisible.'));
          image.onload = () => {
            const maxWidth = 720;
            const ratio = image.width > 0 ? maxWidth / image.width : 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(maxWidth, image.width || maxWidth);
            canvas.height = Math.round((image.height || maxWidth) * ratio);
            const context = canvas.getContext('2d');
            if (!context) {
              reject(new Error('Conversion du SVG impossible.'));
              return;
            }
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            resolve({ base64: dataUrl.split(',')[1], mime: 'image/png', fileName: 'logo.png' });
          };
          image.src = result;
          return;
        }
        const [, base64 = ''] = result.split(',');
        resolve({ base64, mime: file.type, fileName: file.name });
      };
      reader.readAsDataURL(file);
    });

  const handleLogo = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      toast.error('Format non pris en charge', 'Utilisez un fichier PNG, JPG ou SVG.');
      return;
    }
    if (file.size > 3 * 1024 * 1024 && file.type !== 'image/svg+xml') {
      toast.error('Logo trop volumineux', 'La taille maximale est de 3 Mo.');
      return;
    }
    setUploading(true);
    try {
      const image = await readImage(file);
      const saved = await api.settings.uploadLogo({
        fileName: image.fileName,
        mime: image.mime,
        base64: image.base64,
      });
      setDraft(structuredClone(saved));
      await refreshSettings();
      toast.success('Logo importé', file.type === 'image/svg+xml' ? 'SVG converti en PNG pour le PDF.' : undefined);
    } catch (reason) {
      toast.error('Import impossible', errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    try {
      const saved = await api.settings.removeLogo();
      setDraft(structuredClone(saved));
      await refreshSettings();
      toast.success('Logo supprimé');
    } catch (reason) {
      toast.error('Suppression impossible', errorMessage(reason));
    }
  };

  const setRegime = (regime: VatRegime | null) => {
    patch((next) => {
      next.fiscal.regime = regime;
      if (regime !== 'normal') {
        next.fiscal.vatRates = [0];
        next.documents.defaultVatRateBp = 0;
      } else if (next.fiscal.vatRates.length <= 1) {
        next.fiscal.vatRates = [2000, 1000, 550, 210];
        next.documents.defaultVatRateBp = 2000;
      }
      if (regime === 'franchise' && !next.fiscal.franchiseMention) {
        next.fiscal.franchiseMention = FRANCHISE_MENTION_PRESETS[0].text;
      }
    });
  };

  const sellerPreview = {
    displayName: companyDisplayName(draft) || 'Votre entreprise',
    legalName: draft.business.legalName,
    legalForm: draft.business.legalForm,
    siren: draft.business.siren,
    address: draft.business.address,
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Identité de l'entreprise"
        subtitle="Ces informations alimentent vos documents : elles sont figées sur chaque facture au moment de son émission."
        actions={
          <>
            <Button variant="ghost" icon={<Save size={15} />} loading={saving} onClick={() => void save(false)}>
              Enregistrer
            </Button>
            <Button
              icon={<CheckCircle2 size={15} />}
              loading={saving}
              disabled={!ready}
              onClick={() => void save(true)}
            >
              Finaliser la configuration
            </Button>
          </>
        }
      />

      {error ? <InlineError message={error} /> : null}

      {!draft.setupCompleted ? (
        <div className="setup-banner">
          <span className="setup-banner-icon">
            <ShieldCheck size={18} />
          </span>
          <div>
            <strong>Configuration initiale {ready ? 'prête à être finalisée' : 'en cours'}</strong>
            <p>
              {ready
                ? 'Toutes les informations indispensables sont renseignées. Finalisez pour activer la facturation.'
                : 'Les éléments ci-dessous sont nécessaires pour émettre des factures conformes.'}
            </p>
            {issues.length > 0 ? (
              <ul className="setup-issues">
                {issues.slice(0, 4).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {!ready && setupSkipped ? (
            <Button size="sm" variant="soft" onClick={skipSetup}>
              Masquer
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="identity-layout">
        <div className="identity-main">
          <Card>
            <CardHeader title="Identité légale" subtitle="Émetteur des documents" icon={Building2} />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Nom commercial" hint="Apparaît en en-tête s'il est renseigné.">
                  <TextInput
                    value={draft.business.tradeName}
                    onChange={(event) => patch((next) => { next.business.tradeName = event.target.value; })}
                    placeholder="Atelier Lumen"
                    maxLength={200}
                  />
                </Field>
                <Field label="Raison sociale" required>
                  <TextInput
                    value={draft.business.legalName}
                    onChange={(event) => patch((next) => { next.business.legalName = event.target.value; })}
                    placeholder="Atelier Lumen SAS"
                    maxLength={200}
                  />
                </Field>
                <Field label="Forme juridique">
                  <Select
                    value={draft.business.legalForm}
                    onChange={(event) =>
                      patch((next) => {
                        next.business.legalForm = event.target.value;
                        if (!requiresRcs(event.target.value)) next.business.rcsApplicable = false;
                        if (!requiresCapital(event.target.value)) next.business.capitalCents = null;
                      })
                    }
                  >
                    <option value="">Non précisée</option>
                    {LEGAL_FORMS.map((form) => (
                      <option key={form} value={form}>
                        {form}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Statut juridique">
                  <Select
                    value={draft.business.legalStatus}
                    onChange={(event) => patch((next) => { next.business.legalStatus = event.target.value; })}
                  >
                    <option value="">Non précisé</option>
                    {LEGAL_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </Select>
                </Field>
                {requiresCapital(draft.business.legalForm) ? (
                  <Field label="Capital social">
                    <MoneyInput
                      value={draft.business.capitalCents ?? 0}
                      onChange={(value) => patch((next) => { next.business.capitalCents = value > 0 ? value : null; })}
                    />
                  </Field>
                ) : null}
                <Field label="Activité principale">
                  <TextInput
                    value={draft.business.activity}
                    onChange={(event) => patch((next) => { next.business.activity = event.target.value; })}
                    placeholder="Développement logiciel"
                    maxLength={500}
                  />
                </Field>
                <Field label="Code APE / NAF">
                  <TextInput
                    value={draft.business.ape}
                    onChange={(event) => patch((next) => { next.business.ape = event.target.value.toUpperCase(); })}
                    placeholder="6201Z"
                    maxLength={10}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Coordonnées" subtitle="Adresse du siège et contact" />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Adresse" required className="span-2">
                  <TextInput
                    value={draft.business.address.line1}
                    onChange={(event) => patch((next) => { next.business.address.line1 = event.target.value; })}
                    placeholder="12 rue des Lilas"
                  />
                </Field>
                <Field label="Complément" className="span-2">
                  <TextInput
                    value={draft.business.address.line2}
                    onChange={(event) => patch((next) => { next.business.address.line2 = event.target.value; })}
                    placeholder="Bâtiment, étage…"
                  />
                </Field>
                <Field label="Code postal" required>
                  <TextInput
                    value={draft.business.address.postalCode}
                    onChange={(event) => patch((next) => { next.business.address.postalCode = event.target.value; })}
                    placeholder="75011"
                  />
                </Field>
                <Field label="Ville" required>
                  <TextInput
                    value={draft.business.address.city}
                    onChange={(event) => patch((next) => { next.business.address.city = event.target.value; })}
                    placeholder="Paris"
                  />
                </Field>
                <Field label="Pays">
                  <Select
                    value={draft.business.address.country}
                    onChange={(event) => patch((next) => { next.business.address.country = event.target.value; })}
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Téléphone">
                  <TextInput
                    value={draft.identity.phone}
                    onChange={(event) => patch((next) => { next.identity.phone = event.target.value; })}
                    placeholder="+33 1 23 45 67 89"
                  />
                </Field>
                <Field label="E-mail">
                  <TextInput
                    type="email"
                    value={draft.identity.email}
                    onChange={(event) => patch((next) => { next.identity.email = event.target.value; })}
                    placeholder="contact@exemple.fr"
                  />
                </Field>
                <Field label="Site web">
                  <TextInput
                    value={draft.identity.website}
                    onChange={(event) => patch((next) => { next.identity.website = event.target.value; })}
                    placeholder="https://exemple.fr"
                  />
                </Field>
                <Field label="Prénom du dirigeant">
                  <TextInput
                    value={draft.identity.firstName}
                    onChange={(event) => patch((next) => { next.identity.firstName = event.target.value; })}
                  />
                </Field>
                <Field label="Nom du dirigeant">
                  <TextInput
                    value={draft.identity.lastName}
                    onChange={(event) => patch((next) => { next.identity.lastName = event.target.value; })}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Immatriculation" subtitle="Identifiants légaux imprimés sur les documents" icon={ShieldCheck} />
            <div className="card-body">
              <div className="form-grid">
                <Field
                  label="SIREN"
                  required
                  hint="9 chiffres. Obligatoire pour une entreprise française."
                  error={draft.business.siren && !isValidSiren(draft.business.siren) ? 'SIREN invalide (clé de Luhn).' : undefined}
                >
                  <TextInput
                    value={draft.business.siren}
                    onChange={(event) => patch((next) => { next.business.siren = event.target.value.replace(/\s/g, ''); })}
                    placeholder="732829320"
                    maxLength={14}
                  />
                </Field>
                <Field
                  label="SIRET"
                  hint="14 chiffres, établissement."
                  error={draft.business.siret && !isValidSiret(draft.business.siret) ? 'SIRET invalide.' : undefined}
                >
                  <TextInput
                    value={draft.business.siret}
                    onChange={(event) => patch((next) => { next.business.siret = event.target.value.replace(/\s/g, ''); })}
                    placeholder="73282932000009"
                    maxLength={20}
                  />
                </Field>
                <Field
                  label="TVA intracommunautaire"
                  error={draft.business.vatNumber && !isValidFrenchVatNumber(draft.business.vatNumber) ? 'Numéro invalide.' : undefined}
                >
                  <TextInput
                    value={draft.business.vatNumber}
                    onChange={(event) => patch((next) => { next.business.vatNumber = event.target.value.replace(/\s/g, '').toUpperCase(); })}
                    placeholder="FR44732829320"
                    maxLength={20}
                  />
                </Field>
                <Field label="RCS" hint="Ville d'immatriculation et numéro.">
                  <TextInput
                    value={draft.business.rcs}
                    onChange={(event) => patch((next) => { next.business.rcs = event.target.value; })}
                    placeholder="Paris 732 829 320"
                    maxLength={100}
                    disabled={!draft.business.rcsApplicable}
                  />
                </Field>
              </div>
              <Switch
                checked={draft.business.rcsApplicable}
                onChange={(value) => patch((next) => { next.business.rcsApplicable = value; })}
                label="Immatriculée au registre du commerce et des sociétés"
                hint="Obligatoire pour les sociétés commerciales."
              />
              <div className="form-grid">
                <Field label="Répertoire des métiers (RM)">
                  <TextInput
                    value={draft.business.rm}
                    onChange={(event) => patch((next) => { next.business.rm = event.target.value; })}
                    placeholder="Paris"
                    maxLength={100}
                    disabled={!draft.business.rmApplicable}
                  />
                </Field>
              </div>
              <Switch
                checked={draft.business.rmApplicable}
                onChange={(value) => patch((next) => { next.business.rmApplicable = value; })}
                label="Immatriculée au répertoire des métiers"
                hint="Artisans et professionnels concernés."
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Coordonnées bancaires" subtitle="Imprimées pour faciliter le règlement" icon={Landmark} />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Banque">
                  <TextInput
                    value={draft.bank.bankName}
                    onChange={(event) => patch((next) => { next.bank.bankName = event.target.value; })}
                    placeholder="Banque Exemple"
                  />
                </Field>
                <Field label="Titulaire du compte">
                  <TextInput
                    value={draft.bank.accountHolder}
                    onChange={(event) => patch((next) => { next.bank.accountHolder = event.target.value; })}
                    placeholder={draft.business.legalName || 'Raison sociale'}
                  />
                </Field>
                <Field
                  label="IBAN"
                  error={draft.bank.iban && !isValidIban(draft.bank.iban) ? 'IBAN invalide (clé mod-97).' : undefined}
                >
                  <TextInput
                    value={draft.bank.iban}
                    onChange={(event) => patch((next) => { next.bank.iban = event.target.value.replace(/\s/g, '').toUpperCase(); })}
                    placeholder="FR1420041010050500013M02606"
                    maxLength={50}
                  />
                </Field>
                <Field label="BIC" error={draft.bank.bic && !isValidBic(draft.bank.bic) ? 'BIC invalide.' : undefined}>
                  <TextInput
                    value={draft.bank.bic}
                    onChange={(event) => patch((next) => { next.bank.bic = event.target.value.replace(/\s/g, '').toUpperCase(); })}
                    placeholder="BNPAFRPPXXX"
                    maxLength={20}
                  />
                </Field>
                <Field label="Instructions de paiement" className="span-2">
                  <Textarea
                    value={draft.bank.paymentInstructions}
                    onChange={(event) => patch((next) => { next.bank.paymentInstructions = event.target.value; })}
                    rows={2}
                    placeholder="Merci d'indiquer le numéro de facture en référence."
                    maxLength={1000}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Régime de TVA" subtitle="Détermine les taux et mentions obligatoires" icon={Percent} />
            <div className="card-body">
              <Segmented
                options={[
                  { value: 'normal', label: 'Assujetti à la TVA' },
                  { value: 'franchise', label: 'Franchise en base' },
                  { value: 'exemption', label: 'Exonération' },
                ]}
                value={(draft.fiscal.regime ?? '') as VatRegime}
                onChange={(value) => setRegime(value as VatRegime)}
              />
              <div className="form-grid" style={{ marginTop: 16 }}>
                <Field label="Régime fiscal" hint="Ex. : réel normal, réel simplifié, micro-BIC…">
                  <TextInput
                    value={draft.fiscal.fiscalRegime}
                    onChange={(event) => patch((next) => { next.fiscal.fiscalRegime = event.target.value; })}
                    placeholder="Réel simplifié"
                    maxLength={100}
                  />
                </Field>
                <Field label="TVA sur les débits">
                  <div className="switch-inline">
                    <Switch
                      checked={draft.fiscal.debitsOption}
                      onChange={(value) => patch((next) => { next.fiscal.debitsOption = value; })}
                      label={draft.fiscal.debitsOption ? 'Option activée' : 'Option non activée'}
                      hint="À mentionner sur les factures lorsque l'option est exercée."
                    />
                  </div>
                </Field>
              </div>

              {draft.fiscal.regime === 'normal' ? (
                <div className="vat-editor">
                  <p className="field-label">Taux de TVA disponibles</p>
                  <div className="vat-chips">
                    {draft.fiscal.vatRates.map((rate) => (
                      <span key={rate} className="vat-chip">
                        {(rate / 100).toLocaleString('fr-FR')} %
                        {draft.fiscal.vatRates.length > 1 ? (
                          <button
                            type="button"
                            aria-label={`Supprimer le taux ${rate / 100} %`}
                            onClick={() =>
                              patch((next) => {
                                next.fiscal.vatRates = next.fiscal.vatRates.filter((item) => item !== rate);
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  <div className="vat-add">
                    <Select
                      value=""
                      onChange={(event) => {
                        const rate = Number(event.target.value);
                        if (!Number.isFinite(rate)) return;
                        patch((next) => {
                          if (!next.fiscal.vatRates.includes(rate)) {
                            next.fiscal.vatRates = [...next.fiscal.vatRates, rate].sort((a, b) => b - a);
                          }
                        });
                      }}
                    >
                      <option value="">Ajouter un taux…</option>
                      {VAT_RATE_PRESETS.filter((rate) => !draft.fiscal.vatRates.includes(rate)).map((rate) => (
                        <option key={rate} value={rate}>
                          {(rate / 100).toLocaleString('fr-FR')} %
                        </option>
                      ))}
                    </Select>
                    <CustomRateInput
                      onAdd={(bp) =>
                        patch((next) => {
                          if (!next.fiscal.vatRates.includes(bp)) {
                            next.fiscal.vatRates = [...next.fiscal.vatRates, bp].sort((a, b) => b - a);
                          }
                        })
                      }
                    />
                  </div>
                </div>
              ) : null}

              {draft.fiscal.regime === 'franchise' ? (
                <div className="franchise-block">
                  <Field label="Mention de franchise en base" required>
                    <Select
                      value={draft.fiscal.franchiseMention}
                      onChange={(event) => patch((next) => { next.fiscal.franchiseMention = event.target.value; })}
                    >
                      {FRANCHISE_MENTION_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.text}>
                          {preset.label}
                        </option>
                      ))}
                      <option value={draft.fiscal.franchiseMention}>Mention personnalisée…</option>
                    </Select>
                  </Field>
                  <Field
                    label="Texte imprimé sur les factures"
                    hint="Les deux références (CIBS L. 223-3 et CGI 293 B) sont admises jusqu'au 31 décembre 2027."
                  >
                    <Textarea
                      value={draft.fiscal.franchiseMention}
                      onChange={(event) => patch((next) => { next.fiscal.franchiseMention = event.target.value; })}
                      rows={2}
                      maxLength={500}
                    />
                  </Field>
                  <div className="einv-note">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>Aucune TVA ne sera facturée</strong>
                      <p>
                        Les lignes sont verrouillées à 0 % et le contrôle de conformité bloque toute émission avec un
                        taux supérieur tant que ce régime est actif.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {draft.fiscal.regime === 'exemption' ? (
                <Field label="Motif d'exonération" required hint="Imprimé sur les factures, avec la référence légale applicable.">
                  <Textarea
                    value={draft.fiscal.exemptionReason}
                    onChange={(event) => patch((next) => { next.fiscal.exemptionReason = event.target.value; })}
                    rows={2}
                    maxLength={500}
                    placeholder="Exonération de TVA en application de l'article 261 du CGI…"
                  />
                </Field>
              ) : null}

              {draft.fiscal.regime === null ? (
                <p className="field-hint">Sélectionnez un régime : le contrôle de conformité bloquera l'émission tant qu'il n'est pas défini.</p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Marque & apparence" subtitle="Logo et couleurs utilisés sur les PDF" icon={Palette} />
            <div className="card-body">
              <div className="logo-block">
                <div
                  className={`logo-drop ${dragOver ? 'is-over' : ''}`.trim()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) void handleLogo(file);
                  }}
                >
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo de l'entreprise" />
                  ) : (
                    <span className="logo-placeholder">
                      <ImagePlus size={24} />
                      <small>PNG, JPG ou SVG</small>
                    </span>
                  )}
                </div>
                <div className="logo-actions">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleLogo(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    variant="secondary"
                    icon={<Upload size={14} />}
                    loading={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    Importer un logo
                  </Button>
                  {draft.branding.logo ? (
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void removeLogo()}>
                      Supprimer
                    </Button>
                  ) : null}
                  <p className="field-hint">
                    Taille maximale 3 Mo. Le SVG est converti en PNG pour être intégré au PDF. Le logo est affiché
                    uniquement si l'option ci-dessous est active.
                  </p>
                </div>
              </div>
              <Switch
                checked={draft.branding.showLogo}
                onChange={(value) => patch((next) => { next.branding.showLogo = value; })}
                label="Afficher le logo sur les documents"
              />
              <div className="form-grid color-grid">
                <Field label="Couleur principale">
                  <div className="color-input">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(draft.branding.primaryColor) ? draft.branding.primaryColor : '#6D5CF6'}
                      onChange={(event) => patch((next) => { next.branding.primaryColor = event.target.value; })}
                      aria-label="Couleur principale"
                    />
                    <TextInput
                      value={draft.branding.primaryColor}
                      onChange={(event) => patch((next) => { next.branding.primaryColor = event.target.value; })}
                      maxLength={7}
                    />
                  </div>
                </Field>
                <Field label="Couleur secondaire">
                  <div className="color-input">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(draft.branding.secondaryColor) ? draft.branding.secondaryColor : '#0F172A'}
                      onChange={(event) => patch((next) => { next.branding.secondaryColor = event.target.value; })}
                      aria-label="Couleur secondaire"
                    />
                    <TextInput
                      value={draft.branding.secondaryColor}
                      onChange={(event) => patch((next) => { next.branding.secondaryColor = event.target.value; })}
                      maxLength={7}
                    />
                  </div>
                </Field>
              </div>

              <div className="brand-preview" style={{ ['--brand' as string]: draft.branding.primaryColor }}>
                <div className="brand-preview-head">
                  <div className="brand-preview-identity">
                    {logoUrl && draft.branding.showLogo ? (
                      <img src={logoUrl} alt="" />
                    ) : (
                      <span className="brand-preview-mark">{(sellerPreview.displayName || 'FP').slice(0, 2).toUpperCase()}</span>
                    )}
                    <div>
                      <strong>{sellerPreview.displayName}</strong>
                      <p>{formatAddressLines(sellerPreview.address).join(' · ') || 'Adresse à compléter'}</p>
                      <p>
                        {[sellerPreview.siren ? `SIREN ${sellerPreview.siren}` : '', draft.business.vatNumber ? `TVA ${draft.business.vatNumber}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="brand-preview-doc">
                    <span>FACTURE</span>
                    <strong>{draft.documents.invoicePrefix || 'FAC'}-{new Date().getFullYear()}-0001</strong>
                  </div>
                </div>
                <p className="brand-preview-note">
                  Aperçu de l'en-tête uniquement — aucun montant ni client fictif n'est généré.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <aside className="identity-aside">
          <Card>
            <CardHeader title="Complétude" subtitle="Éléments indispensables" icon={ShieldCheck} />
            <div className="card-body">
              <div className={`completeness ${ready ? 'is-ready' : ''}`}>
                <span>{ready ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}</span>
                <div>
                  <strong>{ready ? 'Fiche complète' : 'À compléter'}</strong>
                  <p>
                    {ready
                      ? 'Les informations indispensables sont renseignées.'
                      : `${issues.length} élément${issues.length > 1 ? 's' : ''} à corriger.`}
                  </p>
                </div>
              </div>
              {issues.length > 0 ? (
                <>
                  <ul className="issue-list">
                    {issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  <Link to="/parametres" className="issue-link">
                    Compléter les mentions légales et les valeurs par défaut
                  </Link>
                </>
              ) : (
                <>
                  <ul className="issue-list is-ok">
                    <li>Identité légale renseignée</li>
                    <li>SIREN valide</li>
                    <li>Régime de TVA défini</li>
                    <li>Adresse du siège complète</li>
                  </ul>
                  {!draft.business.legalForm.trim() ? (
                    <p className="aside-note">
                      Forme juridique non renseignée : elle est facultative pour une entreprise individuelle, mais
                      obligatoire sur les factures d’une société.
                    </p>
                  ) : null}
                </>
              )}
              <Button
                block
                icon={<CheckCircle2 size={15} />}
                loading={saving}
                disabled={!ready || draft.setupCompleted}
                onClick={() => void save(true)}
              >
                {draft.setupCompleted ? 'Configuration finalisée' : 'Finaliser la configuration'}
              </Button>
              {!draft.setupCompleted ? (
                <Button variant="ghost" size="sm" block onClick={skipSetup}>
                  Configurer plus tard
                </Button>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Aperçu TVA" subtitle="Impact sur les documents" />
            <div className="card-body">
              <div className="info-list">
                <div className="info-row">
                  <span>Régime</span>
                  <strong>{draft.fiscal.regime ? VAT_REGIME_LABEL[draft.fiscal.regime] : 'Non défini'}</strong>
                </div>
                <div className="info-row">
                  <span>Taux disponibles</span>
                  <strong>{draft.fiscal.vatRates.map((rate) => `${(rate / 100).toLocaleString('fr-FR')} %`).join(' · ')}</strong>
                </div>
                <div className="info-row">
                  <span>Mention sur facture</span>
                  <strong>
                    {draft.fiscal.regime === 'normal'
                      ? 'TVA facturée'
                      : draft.fiscal.regime === 'franchise'
                        ? 'Franchise en base'
                        : draft.fiscal.regime === 'exemption'
                          ? 'Exonération'
                          : '—'}
                  </strong>
                </div>
              </div>
              <p className="field-hint">
                Le taux affiché par défaut sur une nouvelle facture est{' '}
                {formatPercentFromBp(draft.documents.defaultVatRateBp ?? 0, 0)}.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Identité — contacts" subtitle="Reprise sur les documents" />
            <div className="card-body">
              <div className="info-list">
                <div className="info-row">
                  <span>Raison sociale</span>
                  <strong>{draft.business.legalName || '—'}</strong>
                </div>
                <div className="info-row">
                  <span>SIRET</span>
                  <strong>{draft.business.siret || '—'}</strong>
                </div>
                <div className="info-row">
                  <span>E-mail</span>
                  <strong>{draft.identity.email || '—'}</strong>
                </div>
                <div className="info-row">
                  <span>Téléphone</span>
                  <strong>{draft.identity.phone || '—'}</strong>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                block
                trailingIcon={<ArrowRight size={14} />}
                onClick={() => window.location.assign('#/parametres')}
              >
                Autres paramètres
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      <div className="settings-footer">
        <span>{companyDisplayName(draft) || 'Entreprise non nommée'} · {draft.business.address.city || 'ville non renseignée'}</span>
        <Button icon={<Save size={15} />} loading={saving} onClick={() => void save(false)}>
          Enregistrer l'identité
        </Button>
      </div>
    </div>
  );
}

function CustomRateInput({ onAdd }: { onAdd: (bp: number) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="custom-rate">
      <input
        className="input input-number"
        inputMode="decimal"
        value={text}
        placeholder="Autre taux…"
        aria-label="Taux de TVA personnalisé"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const parsed = Number.parseFloat(text.replace(',', '.'));
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
            onAdd(Math.round(parsed * 100));
            setText('');
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span className="field-hint">Taux personnalisé, en %</span>
    </div>
  );
}
