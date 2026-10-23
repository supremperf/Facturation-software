import type {
  Address,
  ClientSnapshot,
  DocumentType,
  InvoiceLineComputed,
  InvoiceTotals,
  LegalSnapshot,
  OperationNature,
  PaymentMethod,
  SellerSnapshot,
} from '@shared/types';
import { OPERATION_NATURE_LABEL, PAYMENT_METHOD_LABEL, formatAddressLines } from '@shared/constants';
import { euro, formatDateFR } from '../lib/format';
import { useAppData } from '../lib/app-context';

export interface PreviewData {
  type: DocumentType;
  number: string | null;
  issueDate: string;
  dueDate: string;
  serviceDate: string;
  purchaseOrder: string;
  operationNature: OperationNature;
  description: string;
  paymentTerms: string;
  paymentMethod: PaymentMethod;
  notes: string;
  client: ClientSnapshot;
  seller: SellerSnapshot;
  legal: LegalSnapshot;
  billingAddress: Address;
  deliveryAddress: Address | null;
  lines: InvoiceLineComputed[];
  totals: InvoiceTotals;
  globalDiscountType: 'none' | 'percent' | 'amount';
  globalDiscountValue: number;
  draft: boolean;
  sourceInvoiceNumber?: string | null;
}

export function InvoicePreview({ data, scale = 1 }: { data: PreviewData; scale?: number }) {
  const { logoUrl } = useAppData();
  const isCredit = data.type === 'credit_note';
  const title = isCredit ? 'AVOIR' : 'FACTURE';
  const number = data.number ?? 'BROUILLON';

  const legalMentions: string[] = [];
  if (data.legal.vatRegime === 'franchise' && data.legal.franchiseMention) {
    legalMentions.push(data.legal.franchiseMention);
  }
  if (data.legal.vatRegime === 'exemption' && data.legal.exemptionReason) {
    legalMentions.push(data.legal.exemptionReason);
  }
  if (data.legal.vatRegime === 'normal' && data.legal.debitsOption) {
    legalMentions.push("Option pour le paiement de la TVA d'après les débits.");
  }
  if (data.legal.latePenaltyRateBp !== null && data.legal.latePenaltyRateBp !== undefined) {
    legalMentions.push(
      `Pénalités de retard : ${(data.legal.latePenaltyRateBp / 100).toLocaleString('fr-FR')} % par an, applicables de plein droit en cas de paiement après l'échéance.`,
    );
  }
  if (data.legal.recoveryIndemnity) {
    legalMentions.push(
      'Indemnité forfaitaire pour frais de recouvrement : 40 € pour tout professionnel en situation de retard de paiement.',
    );
  }
  if (data.legal.escompte) legalMentions.push(data.legal.escompte);
  if (data.client.type === 'particulier' && data.legal.consumerGoodsMention) {
    legalMentions.push(data.legal.consumerGoodsMention);
  }
  if (data.legal.mediatorName) {
    legalMentions.push(
      `Médiation de la consommation : ${data.legal.mediatorName}${data.legal.mediatorUrl ? ` — ${data.legal.mediatorUrl}` : ''}.`,
    );
  }

  const sellerAddress = formatAddressLines(data.seller.address);
  const clientAddress = formatAddressLines(data.billingAddress);
  const delivery = data.deliveryAddress ? formatAddressLines(data.deliveryAddress) : [];
  const showDelivery = delivery.length > 0 && delivery.join('|') !== clientAddress.join('|');

  return (
    <div className="preview-scroll">
      <div
        className="paper"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          ['--paper-accent' as string]: data.seller.primaryColor || '#6c5ce7',
        }}
      >
        {data.draft ? <div className="paper-watermark">APERÇU</div> : null}
        <header className="paper-head">
          <div className="paper-seller">
            {logoUrl && data.seller.logoPath ? (
              <img src={logoUrl} alt="Logo de l'entreprise" className="paper-logo" />
            ) : (
              <div className="paper-logo-fallback">{(data.seller.displayName || 'FP').slice(0, 2).toUpperCase()}</div>
            )}
            <div>
              <strong className="paper-seller-name">{data.seller.displayName || 'Votre entreprise'}</strong>
              <p>{sellerAddress.join(' · ')}</p>
              {data.seller.phone || data.seller.email ? (
                <p>
                  {[data.seller.phone, data.seller.email].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              <p className="paper-ids">
                {[
                  data.seller.siren ? `SIREN ${data.seller.siren}` : '',
                  data.seller.siret ? `SIRET ${data.seller.siret}` : '',
                  data.seller.vatNumber ? `TVA ${data.seller.vatNumber}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <div className="paper-title">
            <span className="paper-type">{title}</span>
            <strong>{number}</strong>
            <p>Émise le {formatDateFR(data.issueDate)}</p>
            {isCredit ? (
              <p>
                {data.sourceInvoiceNumber
                  ? `Avoir sur facture ${data.sourceInvoiceNumber}`
                  : 'Avoir sur facture'}
              </p>
            ) : (
              <p>Échéance {formatDateFR(data.dueDate)}</p>
            )}
          </div>
        </header>

        <div className="paper-parties">
          <div>
            <p className="paper-label">Facturé à</p>
            <strong>{data.client.displayName || 'Client'}</strong>
            {data.client.companyName && data.client.companyName !== data.client.displayName ? (
              <p>{data.client.companyName}</p>
            ) : null}
            {clientAddress.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {data.client.siren ? <p className="paper-ids">SIREN {data.client.siren}</p> : null}
            {data.client.vatNumber ? <p className="paper-ids">TVA {data.client.vatNumber}</p> : null}
          </div>
          {showDelivery ? (
            <div>
              <p className="paper-label">Adresse de livraison</p>
              {delivery.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          <div className="paper-meta">
            <div>
              <span>Date de prestation</span>
              <strong>{formatDateFR(data.serviceDate)}</strong>
            </div>
            <div>
              <span>Règlement</span>
              <strong>{data.paymentTerms || `${PAYMENT_METHOD_LABEL[data.paymentMethod]} à réception`}</strong>
            </div>
            <div>
              <span>Nature</span>
              <strong>{OPERATION_NATURE_LABEL[data.operationNature]}</strong>
            </div>
            {data.purchaseOrder ? (
              <div>
                <span>Bon de commande</span>
                <strong>{data.purchaseOrder}</strong>
              </div>
            ) : null}
          </div>
        </div>

        {data.description ? (
          <div className="paper-object">
            <p className="paper-label">Objet</p>
            <p>{data.description}</p>
          </div>
        ) : null}

        <table className="paper-lines">
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Réf.</th>
              <th className="num">Qté</th>
              <th>Unité</th>
              <th className="num">P.U. HT</th>
              <th className="num">Remise</th>
              <th className="num">TVA</th>
              <th className="num">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.designation || '—'}</strong>
                  {line.description ? <span className="paper-line-desc">{line.description}</span> : null}
                </td>
                <td>{line.reference || '—'}</td>
                <td className="num">{line.quantity.toLocaleString('fr-FR')}</td>
                <td>{line.unit}</td>
                <td className="num">{euro(line.unitPriceCents)}</td>
                <td className="num">
                  {line.discountType === 'percent'
                    ? `${(line.discountValue / 100).toLocaleString('fr-FR')} %`
                    : line.discountType === 'amount'
                      ? euro(line.discountValue)
                      : '—'}
                </td>
                <td className="num">{(line.vatRateBp / 100).toLocaleString('fr-FR')} %</td>
                <td className="num">{euro(line.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="paper-bottom">
          <div className="paper-payment">
            {data.seller.bank.iban ? (
              <>
                <p className="paper-label">Coordonnées bancaires</p>
                <p>
                  <strong>{data.seller.bank.bankName || 'Banque'}</strong>
                </p>
                <p>IBAN : {data.seller.bank.iban}</p>
                {data.seller.bank.bic ? <p>BIC : {data.seller.bank.bic}</p> : null}
                {data.seller.bank.paymentInstructions ? <p>{data.seller.bank.paymentInstructions}</p> : null}
              </>
            ) : (
              <p className="paper-muted">Coordonnées bancaires non renseignées.</p>
            )}
            {data.notes ? (
              <>
                <p className="paper-label" style={{ marginTop: 10 }}>
                  Notes
                </p>
                <p>{data.notes}</p>
              </>
            ) : null}
          </div>

          <div className="paper-totals">
            <div>
              <span>Sous-total HT</span>
              <strong>{euro(data.totals.subtotalCents)}</strong>
            </div>
            {data.totals.lineDiscountCents > 0 ? (
              <div>
                <span>Remises de ligne</span>
                <strong>−{euro(data.totals.lineDiscountCents)}</strong>
              </div>
            ) : null}
            {data.totals.globalDiscountCents > 0 ? (
              <div>
                <span>
                  Remise globale
                  {data.globalDiscountType === 'percent'
                    ? ` (${(data.globalDiscountValue / 100).toLocaleString('fr-FR')} %)`
                    : ''}
                </span>
                <strong>−{euro(data.totals.globalDiscountCents)}</strong>
              </div>
            ) : null}
            <div>
              <span>Total HT</span>
              <strong>{euro(data.totals.totalHtCents)}</strong>
            </div>
            {data.totals.vatBreakdown.length === 0 || data.legal.vatRegime !== 'normal' ? (
              <div>
                <span>TVA</span>
                <strong>0,00 €</strong>
              </div>
            ) : (
              data.totals.vatBreakdown.map((entry) => (
                <div key={entry.rateBp}>
                  <span>TVA {(entry.rateBp / 100).toLocaleString('fr-FR')} %</span>
                  <strong>{euro(entry.vatCents)}</strong>
                </div>
              ))
            )}
            <div className="paper-total-ttc">
              <span>{isCredit ? 'Total avoir TTC' : 'Total TTC'}</span>
              <strong>{euro(data.totals.totalTtcCents)}</strong>
            </div>
          </div>
        </div>

        <div className="paper-legal">
          <p className="paper-label">Mentions légales</p>
          {legalMentions.length === 0 ? (
            <p className="paper-muted">
              Complétez vos mentions légales dans les paramètres pour les afficher sur vos documents.
            </p>
          ) : (
            legalMentions.map((mention, index) => <p key={index}>{mention}</p>)
          )}
          <p className="paper-footer-line">
            {[data.seller.legalName, data.seller.legalForm, data.seller.rcs].filter(Boolean).join(' · ')}
          </p>
        </div>

        <footer className="paper-foot">
          <span>
            {data.seller.legalName || data.seller.displayName} — {title} {number}
          </span>
          <span>Page 1/1</span>
        </footer>
      </div>
    </div>
  );
}
