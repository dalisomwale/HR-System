# Microsoft Entra ID Setup

Microsoft sign-in is the only way into the system. This guide registers the application in the Altus Microsoft Entra tenant. It needs an Entra administrator, or someone with the Application Developer role.

## 1. Register the application

1. Go to **entra.microsoft.com** → Identity → Applications → **App registrations** → **New registration**.
2. **Name:** `Altus Leave Management`.
3. **Supported account types:** _Accounts in this organizational directory only (single tenant)_. This is what limits sign-in to Altus accounts; the server also checks the tenant on every sign-in.
4. **Redirect URI:** platform **Web**, value:
   - Local development: `http://localhost:5173/api/auth/callback`
   - Production: `https://<your leave system domain>/api/auth/callback`
5. Select **Register**.

## 2. Add the sign-out return address

App registration → **Authentication** → under **Web**, add a second redirect URI:

- Local: `http://localhost:5173/signed-out`
- Production: `https://<your domain>/signed-out`

Leave **Access tokens** and **ID tokens** (implicit grant) unticked. The system uses the authorisation-code flow with PKCE and does not need them.

## 3. Create a client secret

App registration → **Certificates & secrets** → **New client secret**. Choose an expiry (6 or 12 months) and note the date: sign-in stops working when it expires. Copy the **Value** immediately; it is shown only once. Do not copy the _Secret ID_.

Put a reminder in the IT calendar to rotate the secret before it expires.

## 4. Permissions

App registration → **API permissions**. The default _Microsoft Graph → User.Read (delegated)_ is enough. The system asks only for `openid`, `profile` and `email` at sign-in.

## 5. Optional: limit who can sign in

To allow only specific staff, open **Enterprise applications** → _Altus Leave Management_ → **Properties**, set **Assignment required** to _Yes_, then add users or groups under **Users and groups**. Without this, any Altus account can reach the sign-in step, but only people HR has linked to an employee record get in.

## 6. Configure the server

From the app registration's **Overview** page, copy the _Directory (tenant) ID_ and _Application (client) ID_. Add them to `.env`:

```
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<secret Value>
ENTRA_REDIRECT_URI=http://localhost:5173/api/auth/callback
SESSION_SECRET=<output of: openssl rand -hex 32>
```

All four `ENTRA_` values are needed together; the server refuses to start with only some of them.

## 7. Create the first System Administrator

Find your own **Object ID**: Entra admin centre → Users → your account → _Object ID_. Then:

```bash
npm run bootstrap:admin -- \
  --oid <your Object ID> \
  --email <your work email> \
  --employee-number <your employee number> \
  --first-name <first name> --last-name <last name> \
  --start-date <YYYY-MM-DD> --job-title "<your job title>"
```

This works only once, while no System Administrator exists. Everyone else is added inside the application.

## 8. Linking everyone else

1. Add staff under **Employees**, or import them under **Import employees**.
2. Ask each person to open the system and sign in once. They will see "Your account is not set up yet".
3. Under **Sign-in requests**, their attempt is listed. The matching employee is suggested when the work email matches. Select **Link**.
4. They can now sign in.

Alternatively, enter a person's Object ID directly on their employee page.

## Troubleshooting

| What you see                                               | Cause                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Microsoft sign-in has not been set up on this server yet" | One or more `ENTRA_` values missing from `.env`; restart the server after adding them   |
| Microsoft error AADSTS50011 (redirect URI mismatch)        | `ENTRA_REDIRECT_URI` does not exactly match a redirect URI in the app registration      |
| Microsoft error AADSTS7000215 (invalid client secret)      | The secret _Value_ is wrong, or the _Secret ID_ was copied instead, or it has expired   |
| "Your account is not set up yet"                           | Signed in successfully, but not linked to an employee. Link them under Sign-in requests |
| "Your access has ended"                                    | The linked employee record is inactive                                                  |
