# Email setup (Microsoft 365)

The leave system sends email through Microsoft Graph from one mailbox, using its own app registration. Until this is set up, everything else works and people still see notifications inside the system; only email is off.

## 1. Choose the sending mailbox

Use a **shared mailbox** such as `leave@altus.co.zm` (Exchange admin centre → Recipients → Mailboxes → Add a shared mailbox). A shared mailbox needs no licence. Emails show this address as the sender.

## 2. Register the mail app

Use a separate app registration from the sign-in app, so the sign-in secret cannot be used to send mail.

1. Microsoft Entra admin centre → App registrations → New registration.
2. Name: `Altus Leave – Mail`. Supported account types: this organisation only. No redirect URI.
3. Note the **Application (client) ID**.
4. Certificates & secrets → New client secret. Copy the **value** straight away. Set a calendar reminder to replace it before it expires.
5. **Do not add the Mail.Send permission here.** Granting Mail.Send in Entra lets the app send as _any_ mailbox in the tenant. Step 3 gives it permission for the leave mailbox only.

## 3. Allow the app to send from that mailbox only

In PowerShell (Microsoft Graph and Exchange Online modules), as an administrator:

```powershell
Connect-MgGraph -Scopes "Application.Read.All"
$SP = Get-MgServicePrincipal -Filter "displayName eq 'Altus Leave – Mail'"

Connect-ExchangeOnline
New-ServicePrincipal -AppId $SP.AppId -ObjectId $SP.Id -DisplayName $SP.DisplayName

# Check that the filter matches only the leave mailbox
Get-Recipient -RecipientPreviewFilter "PrimarySmtpAddress -eq 'leave@altus.co.zm'"

New-ManagementScope -Name "Altus Leave mailbox" `
  -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'leave@altus.co.zm'"
New-ManagementRoleAssignment -App $SP.AppId -Role "Application Mail.Send" `
  -CustomResourceScope "Altus Leave mailbox"
```

This is Exchange Online's "RBAC for Applications". If the app was ever given Mail.Send in Entra, remove that permission so only the scoped grant remains.

## 4. Configure the server

In `.env` (and remove `MAIL_OFF_IN_PRODUCTION` if it was set while email was off):

```
MAIL_TRANSPORT=graph
MAIL_SENDER_ADDRESS=leave@altus.co.zm
GRAPH_MAIL_CLIENT_ID=<application (client) ID from step 2>
GRAPH_MAIL_CLIENT_SECRET=<secret value from step 2>
```

`ENTRA_TENANT_ID` (already set for sign-in) is used too. Restart the server.

## 5. Test

Sign in as a System Administrator → Administration → Emails → **Send me a test email**. Your employee record needs a work email. Within a minute the status should read **Accepted by Microsoft**. If it shows a failure, the error from Microsoft is shown next to it, for example:

| Error                     | Usual cause                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `AADSTS7000215`           | Wrong client secret (copy the value, not the secret ID)            |
| `AADSTS700016`            | Wrong client ID or tenant ID                                       |
| `ErrorAccessDenied` / 403 | Step 3 not done, or the scope does not match `MAIL_SENDER_ADDRESS` |
| `ErrorInvalidUser` / 404  | `MAIL_SENDER_ADDRESS` is not a mailbox in the tenant               |

## What the statuses mean

- **Queued**: waiting to be sent (the worker checks every 30 seconds).
- **Sending**: being handed to Microsoft right now.
- **Accepted by Microsoft**: Graph accepted the message. The system cannot see whether it reached the inbox, so it never says "delivered".
- **Failed – will retry**: tried again after 1, 5, 15, 60 and 240 minutes.
- **Failed – gave up**: stopped after the configured number of attempts (`email_max_attempts`, default 5). A System Administrator can resend it from the Emails page.

## What emails contain

Only the request reference, the employee's name, the leave type, dates, number of days, status, what to do next and a link. A sensitive leave type (sick, maternity, family responsibility, pregnancy loss) is shown as "Leave (details in the system)". Reasons, comments, medical details, attachments and other people's balances are never sent.
