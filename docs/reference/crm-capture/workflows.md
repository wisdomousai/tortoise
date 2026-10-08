# Application workflows

## find-and-log

Find the account with crm.account.search (or a contact with crm.contact.search, then its accountId). Results come live from the CRM and are not stored. Adopt the account with crm.account.adopt unless local already says following or adopted, then log the activity against it with crm.activity.log using the time from the source. If source.status is unavailable, use crm.account.list for accounts already adopted and say the CRM could not be searched; never invent CRM IDs.

Operations: `crm.account.search`, `crm.contact.search`, `crm.account.lookup`, `crm.account.adopt`, `crm.account.get`, `crm.activity.log`.

## review-sync

Read crm.sync.status, then list rejected accounts and open activities that were not accepted. Explain each rejection; do not retry by logging the same activity again.

Operations: `crm.sync.status`, `crm.account.list`, `crm.account.get`.
