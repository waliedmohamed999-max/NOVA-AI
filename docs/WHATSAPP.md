# WhatsApp Business in NOVA

WhatsApp runs on the **official WhatsApp Business Platform (Cloud API)** only: no WhatsApp Web, no personal numbers, no passwords. It uses the same CRM records as the rest of NOVA (Lead, Conversation, Message, Campaign, Approval). There is no parallel inbox or contact list.

## Flow

Connect → Receive → Understand → Create lead → Reply → Follow-up → Campaign → Opportunity → Deal → Analytics

| Step | Where | Notes |
|---|---|---|
| Connect | `/whatsapp`, onboarding "Channels" step | Meta Embedded Signup. The business's token is exchanged server-side and stored encrypted (`IntegrationCredential`). Customers never see IDs or tokens. |
| Receive | `POST /api/webhooks/whatsapp` | `X-Hub-Signature-256` is verified in constant time. Events are deduplicated by message id. Routing uses **our** `phone_number_id` mapping only, never the payload or the client. |
| Lead | automatic | One lead per number per workspace (`phoneDigits` is maintained by a DB trigger). A new contact gets a lead with `source = WhatsApp` and a "Started a conversation on WhatsApp" event. |
| Reply | `/whatsapp/inbox` | The reply order is: local intent → approved brain fact/FAQ → AI (small selective context). Levels: OFF · DRAFT · SAFE_AUTO · CUSTOM. AI text is always a draft, and sensitive topics always need a human. |
| 24h window | everywhere | Free text and media are allowed only within 24h of the customer's last message. Outside that window only an **approved** template can be sent. |
| Templates | `/whatsapp/templates` | Local drafts become PENDING only after an explicit "Submit to Meta". A template can be sent only once its status is APPROVED (via sync with Meta). |
| Campaigns | `/whatsapp/campaigns` | Campaign flow: audience filters over the CRM → eligibility (phone, opt-out, suppression, duplicates, consent) → approval → queue batches → provider-reported delivery states. Sending can be paused, resumed or cancelled. |
| Follow-ups | `/whatsapp/followups`, Sales Desk drawer | NOVA drafts follow-ups; nothing is sent in bulk. A human approves each draft or a selection. |
| Analytics | `/whatsapp/analytics`, campaign page | Only recorded and provider-reported numbers: sent, delivered, read, failed, replies, opt-outs, leads, opportunities, won deals. Revenue is shown only from real deal values. |
| Commands | Home command bar | open_whatsapp, open_whatsapp_inbox, whatsapp_unread, create_whatsapp_campaign (draft only), whatsapp_campaign_summary, prepare_whatsapp_followups (drafts), whatsapp_customers, whatsapp_templates. |

## Platform setup (admin, once)

1. In Meta for Developers, create an app of type **Business** and add the **WhatsApp** product.
2. Configure the webhook:
   - Callback URL: `{APP_URL}/api/webhooks/whatsapp`
   - Verify token: `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to `messages`.
3. Set up Embedded Signup:
   - Create a **Facebook Login for Business** configuration for WhatsApp Embedded Signup.
   - Put its id in `WHATSAPP_EMBEDDED_CONFIG_ID`.
   - Set `WHATSAPP_APP_ID` and `WHATSAPP_APP_SECRET`.
4. Optional, for numbers linked by the platform: set `WHATSAPP_ACCESS_TOKEN` (system user token).
5. Get the Meta approvals needed to go live:
   - **App Review** for `whatsapp_business_messaging` and `whatsapp_business_management`.
   - **Business verification**.
   - **Tech Provider** onboarding, for Embedded Signup with customer businesses.
6. Run the admin checks at `/admin/providers`:
   - **Test connection** (read-only).
   - **Send test WhatsApp**: type `SEND TEST WHATSAPP`. It only ever sends to `WHATSAPP_TEST_RECIPIENT`.

## Safety rules (enforced in code)

- **Tokens:** encrypted at rest. They are never logged, shown, or sent to AI.
- **Tenancy:** a `phone_number_id` belongs to one workspace, and a webhook is routed only through that mapping.
- **Opt-out:** `STOP` / `إلغاء`, or custom keywords, set `whatsappOptOut` and add the number to the suppression list. Campaigns re-check opt-out and suppression at send time.
- **No automatic sending of:** price negotiation, discounts, contracts, complaints, legal matters, refunds, custom quotes, or sensitive claims.
- **Delivery states:** they come only from provider webhooks, only move forward, and never duplicate a message.
- **Campaign sending:**
  - Only through the job queue, in batches.
  - The daily cap follows the number's Meta messaging tier.
  - Throughput errors back off and retry.
  - RED quality pauses the campaign.
- **Tests:** the automated suite never sends real messages. `WHATSAPP_FAKE_TRANSPORT=true` is ignored in production.
