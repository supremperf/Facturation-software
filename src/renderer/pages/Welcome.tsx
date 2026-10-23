import { useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  FileText,
  HardDrive,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AppSettings, VatRegime } from '@shared/types';
import { VAT_REGIME_LABEL } from '@shared/constants';
import { isValidSiren } from '@shared/validators';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useToast } from '../components/Toast';
import { Button, Field, Select, TextInput } from '../components/ui';

export function WelcomePage() {
  const { settings, refreshSettings, bumpData, skipSetup } = useAppData();
  const toast = useToast();
  const [legalName, setLegalName] = useState(settings?.business.legalName ?? '');
  const [tradeName, setTradeName] = useState(settings?.business.tradeName ?? '');
  const [siren, setSiren] = useState(settings?.business.siren ?? '');
  const [line1, setLine1] = useState(settings?.business.address.line1 ?? '');
  const [postalCode, setPostalCode] = useState(settings?.business.address.postalCode ?? '');
  const [city, setCity] = useState(settings?.business.address.city ?? '');
  const [regime, setRegime] = useState<VatRegime>(settings?.fiscal.regime ?? 'normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    legalName.trim().length > 1 &&
    isValidSiren(siren) &&
    line1.trim().length > 3 &&
    postalCode.trim().length >= 4 &&
    city.trim().length > 1;

  const start = async () => {
    if (!settings) return;
    if (!valid) {
      setError('Complétez les champs obligatoires : raison sociale, SIREN valide et adresse du siège.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next: AppSettings = structuredClone(settings);
      next.business.legalName = legalName.trim();
      next.business.tradeName = tradeName.trim();
      next.business.siren = siren.replace(/\s/g, '');
      next.business.address.line1 = line1.trim();
      next.business.address.postalCode = postalCode.trim();
      next.business.address.city = city.trim();
      next.fiscal.regime = regime;
      if (regime !== 'normal') {
        next.fiscal.vatRates = [0];
        next.documents.defaultVatRateBp = 0;
      }
      if (regime === 'franchise' && !next.fiscal.franchiseMention.trim()) {
        next.fiscal.franchiseMention =
          'TVA non applicable, art. L. 223-3 du code des impositions sur les biens et services (CIBS).';
      }
      next.setupCompleted = true;
      await api.settings.save(next);
      await refreshSettings();
      bumpData();
      skipSetup();
      toast.success('Espace configuré', 'Vous pouvez maintenant créer votre premier client.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-brand">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <span>
            <strong>FacturePro</strong>
            <small>Édition 2026</small>
          </span>
        </div>
        <div className="welcome-copy">
          <p className="eyebrow">Facturation française</p>
          <h1>
            Vos factures,
            <br />
            <span>sans compromis.</span>
          </h1>
          <p className="welcome-lead">
            Une application de bureau complète, hors ligne, pensée pour les indépendants et les petites entreprises
            françaises. Vos données restent sur votre poste.
          </p>
          <ul className="welcome-features">
            <li>
              <BadgeCheck size={17} />
              <div>
                <strong>Conformité 2026</strong>
                <p>Mentions obligatoires, SIREN client, franchise en base et calendrier e-invoicing.</p>
              </div>
            </li>
            <li>
              <ShieldCheck size={17} />
              <div>
                <strong>Documents immuables</strong>
                <p>Corrections uniquement par avoir, traçabilité complète, aucune suppression d'émise.</p>
              </div>
            </li>
            <li>
              <FileText size={17} />
              <div>
                <strong>PDF professionnels</strong>
                <p>A4 multipage, logo, pagination, texte sélectionnable et accents fidèles.</p>
              </div>
            </li>
            <li>
              <HardDrive size={17} />
              <div>
                <strong>100 % local</strong>
                <p>Base SQLite dans %APPDATA%, sauvegardes ZIP, aucun compte ni serveur.</p>
              </div>
            </li>
          </ul>
        </div>
        <p className="welcome-legal">
          FacturePro n'est ni un cabinet comptable ni une plateforme agréée de facturation électronique. Les
          informations légales saisies restent sous votre responsabilité.
        </p>
      </div>

      <div className="welcome-panel">
        <div className="welcome-form">
          <div className="welcome-form-head">
            <span className="welcome-step">Étape 1 · Entreprise</span>
            <h2>Configurons votre espace</h2>
            <p>Ces informations apparaîtront sur vos documents. Vous pourrez les compléter ensuite.</p>
          </div>

          {error ? <div className="welcome-error">{error}</div> : null}

          <div className="form-grid">
            <Field label="Raison sociale" required className="span-2">
              <TextInput
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
                placeholder="Atelier Lumen SAS"
                autoFocus
              />
            </Field>
            <Field label="Nom commercial" className="span-2" hint="Facultatif — utilisé en en-tête s'il est renseigné.">
              <TextInput
                value={tradeName}
                onChange={(event) => setTradeName(event.target.value)}
                placeholder="Atelier Lumen"
              />
            </Field>
            <Field label="SIREN" required hint="9 chiffres, clé de Luhn vérifiée.">
              <TextInput
                value={siren}
                onChange={(event) => setSiren(event.target.value.replace(/\s/g, ''))}
                placeholder="732829320"
                maxLength={14}
              />
            </Field>
            <Field label="Régime de TVA" required>
              <Select value={regime} onChange={(event) => setRegime(event.target.value as VatRegime)}>
                {(Object.keys(VAT_REGIME_LABEL) as VatRegime[]).map((value) => (
                  <option key={value} value={value}>
                    {VAT_REGIME_LABEL[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Adresse du siège" required className="span-2">
              <TextInput
                value={line1}
                onChange={(event) => setLine1(event.target.value)}
                placeholder="12 rue des Lilas"
              />
            </Field>
            <Field label="Code postal" required>
              <TextInput
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="75011"
              />
            </Field>
            <Field label="Ville" required>
              <TextInput value={city} onChange={(event) => setCity(event.target.value)} placeholder="Paris" />
            </Field>
          </div>

          <div className="welcome-note">
            <Building2 size={15} />
            <p>
              Vous pourrez renseigner votre logo, vos coordonnées bancaires, votre SIRET et vos mentions légales
              dans <strong>Identité de l'entreprise</strong>.
            </p>
          </div>

          <div className="welcome-actions">
            <Button size="lg" block loading={saving} trailingIcon={<ArrowRight size={16} />} onClick={start}>
              Créer mon espace
            </Button>
            <Button variant="ghost" size="sm" onClick={skipSetup}>
              Découvrir l'application d'abord
            </Button>
          </div>
          <p className="welcome-privacy">
            Aucune donnée n'est envoyée sur Internet. L'application fonctionne entièrement hors ligne.
          </p>
        </div>
      </div>
    </div>
  );
}
