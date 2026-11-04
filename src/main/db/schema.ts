/** Schéma SQLite versionné. Toute évolution doit ajouter une migration. */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'professionnel',
        civility TEXT NOT NULL DEFAULT '',
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        legal_form TEXT NOT NULL DEFAULT '',
        siren TEXT NOT NULL DEFAULT '',
        siret TEXT NOT NULL DEFAULT '',
        vat_number TEXT NOT NULL DEFAULT '',
        vat_subject INTEGER NOT NULL DEFAULT 1,
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address_line1 TEXT NOT NULL DEFAULT '',
        address_line2 TEXT NOT NULL DEFAULT '',
        postal_code TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT 'France',
        delivery_line1 TEXT NOT NULL DEFAULT '',
        delivery_line2 TEXT NOT NULL DEFAULT '',
        delivery_postal_code TEXT NOT NULL DEFAULT '',
        delivery_city TEXT NOT NULL DEFAULT '',
        delivery_country TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_clients_name ON clients(last_name, first_name, company_name);
      CREATE INDEX IF NOT EXISTS ix_clients_archived ON clients(is_archived);

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'invoice',
        number TEXT,
        sequence_year INTEGER,
        sequence_value INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        service_date TEXT NOT NULL,
        client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
        client_name TEXT NOT NULL DEFAULT '',
        client_snapshot TEXT NOT NULL,
        seller_snapshot TEXT NOT NULL,
        legal_snapshot TEXT NOT NULL,
        billing_address TEXT NOT NULL,
        delivery_address TEXT,
        purchase_order TEXT NOT NULL DEFAULT '',
        operation_nature TEXT NOT NULL DEFAULT 'services',
        description TEXT NOT NULL DEFAULT '',
        payment_terms TEXT NOT NULL DEFAULT '',
        payment_method TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        global_discount_type TEXT NOT NULL DEFAULT 'none',
        global_discount_value INTEGER NOT NULL DEFAULT 0,
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        line_discount_cents INTEGER NOT NULL DEFAULT 0,
        global_discount_cents INTEGER NOT NULL DEFAULT 0,
        total_ht_cents INTEGER NOT NULL DEFAULT 0,
        total_vat_cents INTEGER NOT NULL DEFAULT 0,
        total_ttc_cents INTEGER NOT NULL DEFAULT 0,
        vat_breakdown TEXT NOT NULL DEFAULT '[]',
        paid_cents INTEGER NOT NULL DEFAULT 0,
        credited_cents INTEGER NOT NULL DEFAULT 0,
        source_invoice_id TEXT,
        source_invoice_number TEXT,
        reason TEXT NOT NULL DEFAULT '',
        pdf_path TEXT,
        pdf_sha256 TEXT,
        pdf_generated_at TEXT,
        pdf_size INTEGER,
        legal_report TEXT,
        issued_at TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_number ON invoices(number) WHERE number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ix_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS ix_invoices_type ON invoices(type);
      CREATE INDEX IF NOT EXISTS ix_invoices_issue_date ON invoices(issue_date);
      CREATE INDEX IF NOT EXISTS ix_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS ix_invoices_source ON invoices(source_invoice_id);

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        designation TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        quantity REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'unité',
        unit_price_cents INTEGER NOT NULL DEFAULT 0,
        discount_type TEXT NOT NULL DEFAULT 'none',
        discount_value INTEGER NOT NULL DEFAULT 0,
        vat_rate_bp INTEGER NOT NULL DEFAULT 0,
        is_extra_fee INTEGER NOT NULL DEFAULT 0,
        operation_nature TEXT NOT NULL DEFAULT '',
        gross_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        net_cents INTEGER NOT NULL DEFAULT 0,
        allocated_discount_cents INTEGER NOT NULL DEFAULT 0,
        taxable_base_cents INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        ttc_cents INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_lines_invoice ON invoice_lines(invoice_id, position);

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        method TEXT NOT NULL DEFAULT 'virement',
        reference TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_payments_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS ix_payments_date ON payments(date);

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL DEFAULT 'system',
        entity_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_activities_created ON activities(created_at DESC);

      CREATE TABLE IF NOT EXISTS number_sequences (
        year INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        last_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (year, doc_type)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        actor TEXT NOT NULL DEFAULT 'local'
      );
      CREATE INDEX IF NOT EXISTS ix_audit_timestamp ON audit_log(timestamp);
    `,
  },
  {
    version: 2,
    name: 'sync_tables',
    sql: `
      -- Tables de synchronisation GarageFlows Sync Core
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        source_app TEXT NOT NULL,
        global_id TEXT NOT NULL,
        local_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        field_sources TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 5,
        next_retry_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        created_at TEXT NOT NULL,
        processed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_sync_outbox_status ON sync_outbox(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS ix_sync_outbox_global ON sync_outbox(global_id);
      CREATE INDEX IF NOT EXISTS ix_sync_outbox_idempotency ON sync_outbox(idempotency_key);

      CREATE TABLE IF NOT EXISTS sync_processed_events (
        idempotency_key TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        global_id TEXT NOT NULL,
        source_app TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT 'applied',
        conflict_details TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_sync_processed_global ON sync_processed_events(global_id);

      CREATE TABLE IF NOT EXISTS global_customers (
        global_id TEXT PRIMARY KEY,
        nexa_id INTEGER,
        contract_gen_id TEXT,
        facture_pro_id TEXT,
        nexa_payload_hash TEXT,
        contract_gen_payload_hash TEXT,
        facture_pro_payload_hash TEXT,
        field_sources TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active',
        merge_confidence INTEGER DEFAULT 0,
        merged_into_global_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_global_nexa ON global_customers(nexa_id);
      CREATE INDEX IF NOT EXISTS ix_global_contract_gen ON global_customers(contract_gen_id);
      CREATE INDEX IF NOT EXISTS ix_global_facture_pro ON global_customers(facture_pro_id);
      CREATE INDEX IF NOT EXISTS ix_global_status ON global_customers(status);

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        global_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        local_value TEXT,
        remote_value TEXT,
        local_source TEXT NOT NULL,
        remote_source TEXT NOT NULL,
        master_source TEXT NOT NULL,
        resolution TEXT DEFAULT 'pending',
        resolved_value TEXT,
        resolved_at TEXT,
        resolved_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_conflicts_global ON sync_conflicts(global_id, resolution);

      CREATE TABLE IF NOT EXISTS sync_metrics (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO sync_metrics (key, value, updated_at) VALUES
        ('eventsPending', 0, datetime('now')),
        ('eventsProcessedTotal', 0, datetime('now')),
        ('eventsFailedTotal', 0, datetime('now')),
        ('eventsDeadLetter', 0, datetime('now')),
        ('conflictsOpen', 0, datetime('now')),
        ('latencyP50', 0, datetime('now')),
        ('latencyP95', 0, datetime('now')),
        ('latencyP99', 0, datetime('now')),
        ('deduplicationRuns', 0, datetime('now')),
        ('deduplicationMerges', 0, datetime('now'));
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
