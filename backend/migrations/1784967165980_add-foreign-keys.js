// Adds real foreign keys across every table migrated from Firestore so far. ON DELETE choices:
//   - CASCADE: pure detail/membership rows with no independent side effects of their own —
//     deleting the parent through a plain SQL DELETE is equivalent to deleting them one by one.
//   - RESTRICT: relationships the application already guards against deleting-while-in-use
//     (deleteGarden's usage check, deleteCompany's in-use check, deleteKnownUser's ownsGarden
//     check) — the FK is a backstop matching that existing intent, not a new rule.
//   - SET NULL: informational/historical pointer fields (who created/invited/completed
//     something) where losing the referenced row shouldn't block deleting it or delete the
//     row that points to it.
export async function up(pgm) {
  // users as parent
  pgm.sql('ALTER TABLE gardens ADD CONSTRAINT gardens_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT;')
  pgm.sql('ALTER TABLE gardens ADD CONSTRAINT gardens_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE garden_members ADD CONSTRAINT garden_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;')
  pgm.sql('ALTER TABLE garden_members ADD CONSTRAINT garden_members_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE invites ADD CONSTRAINT invites_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE invites ADD CONSTRAINT invites_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE invites ADD CONSTRAINT invites_resent_by_user_id_fkey FOREIGN KEY (resent_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE maintenance_reminders ADD CONSTRAINT maintenance_reminders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE maintenance_reminders ADD CONSTRAINT maintenance_reminders_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE maintenance_reminders ADD CONSTRAINT maintenance_reminders_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE maintenance_reminders ADD CONSTRAINT maintenance_reminders_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE companies ADD CONSTRAINT companies_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE orders ADD CONSTRAINT orders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;')
  pgm.sql('ALTER TABLE assets ADD CONSTRAINT assets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;')

  // gardens as parent
  pgm.sql('ALTER TABLE garden_members ADD CONSTRAINT garden_members_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE CASCADE;')
  pgm.sql('ALTER TABLE invites ADD CONSTRAINT invites_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE CASCADE;')
  pgm.sql('ALTER TABLE dahlia_records ADD CONSTRAINT dahlia_records_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE RESTRICT;')
  pgm.sql('ALTER TABLE maintenance_reminders ADD CONSTRAINT maintenance_reminders_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE RESTRICT;')
  pgm.sql('ALTER TABLE order_items ADD CONSTRAINT order_items_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE RESTRICT;')
  pgm.sql('ALTER TABLE companies ADD CONSTRAINT companies_garden_id_fkey FOREIGN KEY (garden_id) REFERENCES gardens (id) ON DELETE SET NULL;')

  // companies as parent
  pgm.sql('ALTER TABLE orders ADD CONSTRAINT orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT;')
  pgm.sql('ALTER TABLE assets ADD CONSTRAINT assets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE SET NULL;')

  // orders as parent
  pgm.sql('ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;')
  pgm.sql('ALTER TABLE order_files ADD CONSTRAINT order_files_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE;')

  // assets as parent
  pgm.sql('ALTER TABLE asset_files ADD CONSTRAINT asset_files_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE;')
}

export async function down(pgm) {
  pgm.sql('ALTER TABLE asset_files DROP CONSTRAINT asset_files_asset_id_fkey;')
  pgm.sql('ALTER TABLE order_files DROP CONSTRAINT order_files_order_id_fkey;')
  pgm.sql('ALTER TABLE order_items DROP CONSTRAINT order_items_order_id_fkey;')
  pgm.sql('ALTER TABLE assets DROP CONSTRAINT assets_company_id_fkey;')
  pgm.sql('ALTER TABLE orders DROP CONSTRAINT orders_company_id_fkey;')
  pgm.sql('ALTER TABLE companies DROP CONSTRAINT companies_garden_id_fkey;')
  pgm.sql('ALTER TABLE order_items DROP CONSTRAINT order_items_garden_id_fkey;')
  pgm.sql('ALTER TABLE maintenance_reminders DROP CONSTRAINT maintenance_reminders_garden_id_fkey;')
  pgm.sql('ALTER TABLE dahlia_records DROP CONSTRAINT dahlia_records_garden_id_fkey;')
  pgm.sql('ALTER TABLE invites DROP CONSTRAINT invites_garden_id_fkey;')
  pgm.sql('ALTER TABLE garden_members DROP CONSTRAINT garden_members_garden_id_fkey;')
  pgm.sql('ALTER TABLE assets DROP CONSTRAINT assets_owner_user_id_fkey;')
  pgm.sql('ALTER TABLE orders DROP CONSTRAINT orders_owner_user_id_fkey;')
  pgm.sql('ALTER TABLE companies DROP CONSTRAINT companies_owner_user_id_fkey;')
  pgm.sql('ALTER TABLE maintenance_reminders DROP CONSTRAINT maintenance_reminders_completed_by_user_id_fkey;')
  pgm.sql('ALTER TABLE maintenance_reminders DROP CONSTRAINT maintenance_reminders_assigned_to_user_id_fkey;')
  pgm.sql('ALTER TABLE maintenance_reminders DROP CONSTRAINT maintenance_reminders_created_by_user_id_fkey;')
  pgm.sql('ALTER TABLE maintenance_reminders DROP CONSTRAINT maintenance_reminders_owner_user_id_fkey;')
  pgm.sql('ALTER TABLE invites DROP CONSTRAINT invites_resent_by_user_id_fkey;')
  pgm.sql('ALTER TABLE invites DROP CONSTRAINT invites_accepted_by_user_id_fkey;')
  pgm.sql('ALTER TABLE invites DROP CONSTRAINT invites_created_by_user_id_fkey;')
  pgm.sql('ALTER TABLE garden_members DROP CONSTRAINT garden_members_invited_by_user_id_fkey;')
  pgm.sql('ALTER TABLE garden_members DROP CONSTRAINT garden_members_user_id_fkey;')
  pgm.sql('ALTER TABLE gardens DROP CONSTRAINT gardens_created_by_user_id_fkey;')
  pgm.sql('ALTER TABLE gardens DROP CONSTRAINT gardens_owner_user_id_fkey;')
}
