import { useEffect, useState } from 'react';
import { Building2, User } from 'lucide-react';
import type { Address, Client, ClientInput, ClientType } from '@shared/types';
import { COUNTRIES, LEGAL_FORMS } from '@shared/constants';
import { isValidFrenchVatNumber, isValidSiren, isValidSiret } from '@shared/validators';
import { api, errorMessage } from '../lib/api';
import { useToast } from './Toast';
import {
  Button,
  Field,
  Modal,
  Segmented,
  Select,
  Switch,
  TextInput,
  Textarea,
} from './ui';

const emptyAddress = (): Address => ({ line1: '', line2: '', postalCode: '', city: '', country: 'France' });

function defaultInput(): ClientInput {
  return {
    type: 'professionnel',
    civility: '',
    firstName: '',
    lastName: '',
    companyName: '',
    legalForm: '',
    siren: '',
    siret: '',
    vatNumber: '',
    vatSubject: true,
    email: '',
    phone: '',
    address: emptyAddress(),
    deliveryAddress: null,
    notes: '',
  };
}

function fromClient(client: Client): ClientInput {
  return {
    type: client.type,
    civility: client.civility,
    firstName: client.firstName,
    lastName: client.lastName,
    companyName: client.companyName,
    legalForm: client.legalForm,
    siren: client.siren,
    siret: client.siret,
    vatNumber: client.vatNumber,
    vatSubject: client.vatSubject,
    email: client.email,
    phone: client.phone,
    address: { ...client.address },
    deliveryAddress: client.deliveryAddress ? { ...client.deliveryAddress } : null,
    notes: client.notes,
  };
}

interface Errors {
  [key: string]: string | undefined;
}

export function ClientDialog({
  open,
  client,
  onClose,
  onSaved,
  defaultType = 'professionnel',
}: {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onSaved: (client: Client) => void;
  defaultType?: ClientType;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ClientInput>(() => ({ ...defaultInput(), type: defaultType }));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setForm(fromClient(client));
      setDeliveryOpen(Boolean(client.deliveryAddress));
    } else {
      setForm({ ...defaultInput(), type: defaultType });
      setDeliveryOpen(false);
    }
    setErrors({});
  }, [open, client, defaultType]);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const setAddress = (key: keyof Address, value: string) => {
    setForm((previous) => ({ ...previous, address: { ...previous.address, [key]: value } }));
    setErrors((previous) => ({ ...previous, [`address.${key}`]: undefined }));
  };

  const setDelivery = (key: keyof Address, value: string) => {
    setForm((previous) => ({
      ...previous,
      deliveryAddress: { ...(previous.deliveryAddress ?? emptyAddress()), [key]: value },
    }));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    if (form.type === 'professionnel') {
      if (!form.companyName.trim()) next.companyName = 'La raison sociale est obligatoire.';
    } else if (!form.firstName.trim() && !form.lastName.trim()) {
      next.firstName = 'Renseignez au moins un nom ou un prénom.';
    }
    if (form.siren.trim() && !isValidSiren(form.siren)) next.siren = 'SIREN invalide (9 chiffres, clé de Luhn).';
    if (form.siret.trim() && !isValidSiret(form.siret)) next.siret = 'SIRET invalide (14 chiffres).';
    if (form.vatNumber.trim() && !isValidFrenchVatNumber(form.vatNumber)) {
      next.vatNumber = 'Numéro de TVA intracommunautaire invalide.';
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      next.email = 'Adresse e-mail invalide.';
    }
    if (!form.address.line1.trim()) next['address.line1'] = 'Adresse obligatoire.';
    if (!form.address.postalCode.trim()) next['address.postalCode'] = 'Code postal obligatoire.';
    if (!form.address.city.trim()) next['address.city'] = 'Ville obligatoire.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: ClientInput = {
        ...form,
        companyName: form.companyName.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        siren: form.siren.replace(/\s/g, ''),
        siret: form.siret.replace(/\s/g, ''),
        vatNumber: form.vatNumber.replace(/\s/g, '').toUpperCase(),
        address: { ...form.address, country: form.address.country || 'France' },
        deliveryAddress: deliveryOpen && form.deliveryAddress ? form.deliveryAddress : null,
      };
      const saved = client ? await api.clients.update(client.id, payload) : await api.clients.create(payload);
      toast.success(client ? 'Client mis à jour' : 'Client créé', saved.companyName || saved.firstName || saved.lastName);
      onSaved(saved);
      onClose();
    } catch (error) {
      const message = errorMessage(error);
      toast.error('Enregistrement impossible', message);
      const details = (error as { details?: { path?: string; message: string }[] }).details;
      if (Array.isArray(details)) {
        const mapped: Errors = {};
        for (const issue of details) {
          if (issue.path) mapped[issue.path] = issue.message;
        }
        setErrors(mapped);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? 'Modifier le client' : 'Nouveau client'}
      subtitle="Les coordonnées sont figées sur la facture au moment de son émission."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={submit} loading={saving}>
            {client ? 'Enregistrer les modifications' : 'Créer le client'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="form-block">
          <Segmented
            options={[
              { value: 'professionnel', label: 'Professionnel', icon: <Building2 size={14} /> },
              { value: 'particulier', label: 'Particulier', icon: <User size={14} /> },
            ]}
            value={form.type}
            onChange={(value) => set('type', value)}
          />
        </div>

        <div className="form-grid">
          {form.type === 'professionnel' ? (
            <>
              <Field label="Raison sociale" required error={errors.companyName} className="span-2">
                <TextInput
                  value={form.companyName}
                  invalid={Boolean(errors.companyName)}
                  onChange={(event) => set('companyName', event.target.value)}
                  placeholder="Société Martin"
                  autoFocus
                />
              </Field>
              <Field label="Forme juridique">
                <Select value={form.legalForm} onChange={(event) => set('legalForm', event.target.value)}>
                  <option value="">Non précisée</option>
                  {LEGAL_FORMS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contact — civilité">
                <Select value={form.civility} onChange={(event) => set('civility', event.target.value)}>
                  <option value="">—</option>
                  <option value="M.">M.</option>
                  <option value="Mme">Mme</option>
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Civilité">
                <Select value={form.civility} onChange={(event) => set('civility', event.target.value)}>
                  <option value="">—</option>
                  <option value="M.">M.</option>
                  <option value="Mme">Mme</option>
                </Select>
              </Field>
              <span />
            </>
          )}
          <Field label="Prénom" error={errors.firstName} required={form.type === 'particulier'}>
            <TextInput
              value={form.firstName}
              onChange={(event) => set('firstName', event.target.value)}
              placeholder="Élodie"
            />
          </Field>
          <Field label="Nom" required={form.type === 'particulier'}>
            <TextInput
              value={form.lastName}
              onChange={(event) => set('lastName', event.target.value)}
              placeholder="Réné"
            />
          </Field>
          <Field label="E-mail">
            <TextInput
              type="email"
              value={form.email}
              invalid={Boolean(errors.email)}
              onChange={(event) => set('email', event.target.value)}
              placeholder="contact@exemple.fr"
            />
          </Field>
          <Field label="Téléphone">
            <TextInput
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+33 6 12 34 56 78"
            />
          </Field>
        </div>

        {form.type === 'professionnel' ? (
          <div className="form-block">
            <h3 className="form-block-title">Identification professionnelle</h3>
            <div className="form-grid">
              <Field
                label="SIREN"
                error={errors.siren}
                hint="Obligatoire sur la facture d'un client assujetti établi en France."
              >
                <TextInput
                  value={form.siren}
                  invalid={Boolean(errors.siren)}
                  onChange={(event) => set('siren', event.target.value)}
                  placeholder="443061841"
                  maxLength={14}
                />
              </Field>
              <Field label="SIRET" error={errors.siret}>
                <TextInput
                  value={form.siret}
                  invalid={Boolean(errors.siret)}
                  onChange={(event) => set('siret', event.target.value)}
                  placeholder="44306184100005"
                  maxLength={20}
                />
              </Field>
              <Field label="TVA intracommunautaire" error={errors.vatNumber}>
                <TextInput
                  value={form.vatNumber}
                  invalid={Boolean(errors.vatNumber)}
                  onChange={(event) => set('vatNumber', event.target.value)}
                  placeholder="FR12345678901"
                  maxLength={20}
                />
              </Field>
              <Field label="Assujetti à la TVA">
                <div className="switch-inline">
                  <Switch
                    checked={form.vatSubject}
                    onChange={(value) => set('vatSubject', value)}
                    label={form.vatSubject ? 'Oui — TVA facturée' : 'Non — autoliquidation / exonération'}
                  />
                </div>
              </Field>
            </div>
          </div>
        ) : null}

        <div className="form-block">
          <h3 className="form-block-title">Adresse de facturation</h3>
          <div className="form-grid">
            <Field label="Adresse" required error={errors['address.line1']} className="span-2">
              <TextInput
                value={form.address.line1}
                invalid={Boolean(errors['address.line1'])}
                onChange={(event) => setAddress('line1', event.target.value)}
                placeholder="25 avenue de la République"
              />
            </Field>
            <Field label="Complément" className="span-2">
              <TextInput
                value={form.address.line2}
                onChange={(event) => setAddress('line2', event.target.value)}
                placeholder="Bâtiment, étage, service…"
              />
            </Field>
            <Field label="Code postal" required error={errors['address.postalCode']}>
              <TextInput
                value={form.address.postalCode}
                invalid={Boolean(errors['address.postalCode'])}
                onChange={(event) => setAddress('postalCode', event.target.value)}
                placeholder="75011"
                maxLength={12}
              />
            </Field>
            <Field label="Ville" required error={errors['address.city']}>
              <TextInput
                value={form.address.city}
                invalid={Boolean(errors['address.city'])}
                onChange={(event) => setAddress('city', event.target.value)}
                placeholder="Paris"
              />
            </Field>
            <Field label="Pays">
              <Select value={form.address.country} onChange={(event) => setAddress('country', event.target.value)}>
                {COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="form-switch">
            <Switch
              checked={deliveryOpen}
              onChange={(value) => setDeliveryOpen(value)}
              label="Adresse de livraison différente"
              hint="Obligatoire sur la facture lorsque des biens sont livrés à une autre adresse."
            />
          </div>

          {deliveryOpen ? (
            <div className="form-grid form-subgrid">
              <Field label="Adresse de livraison" className="span-2">
                <TextInput
                  value={form.deliveryAddress?.line1 ?? ''}
                  onChange={(event) => setDelivery('line1', event.target.value)}
                  placeholder="Entrepôt — 4 rue des Loges"
                />
              </Field>
              <Field label="Complément" className="span-2">
                <TextInput
                  value={form.deliveryAddress?.line2 ?? ''}
                  onChange={(event) => setDelivery('line2', event.target.value)}
                />
              </Field>
              <Field label="Code postal">
                <TextInput
                  value={form.deliveryAddress?.postalCode ?? ''}
                  onChange={(event) => setDelivery('postalCode', event.target.value)}
                />
              </Field>
              <Field label="Ville">
                <TextInput
                  value={form.deliveryAddress?.city ?? ''}
                  onChange={(event) => setDelivery('city', event.target.value)}
                />
              </Field>
              <Field label="Pays">
                <Select
                  value={form.deliveryAddress?.country ?? 'France'}
                  onChange={(event) => setDelivery('country', event.target.value)}
                >
                  {COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
        </div>

        <Field label="Notes internes" hint="Ces notes ne sont jamais imprimées sur les documents.">
          <Textarea
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Conditions particulières, interlocuteur, historique…"
          />
        </Field>
      </div>
    </Modal>
  );
}
