-- Fix organization_intelligence triggers for Postgres compatibility.
-- Postgres does not support CREATE TRIGGER IF NOT EXISTS; use DROP + CREATE.
-- Run after 08_organization_intelligence_tables (which may fail at the trigger step).

DROP TRIGGER IF EXISTS update_organization_contacts_updated_at ON organization_contacts;
CREATE TRIGGER update_organization_contacts_updated_at
    BEFORE UPDATE ON organization_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_organization_intelligence_updated_at ON organization_intelligence;
CREATE TRIGGER update_organization_intelligence_updated_at
    BEFORE UPDATE ON organization_intelligence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
