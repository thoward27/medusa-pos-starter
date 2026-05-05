# Live Drawing Submissions

## Problem

At markets, Taylor Made sells live pet drawings. Customers order a drawing, provide pet photos + names, then come back later to pick up the finished piece. Today this is tracked with physical cards, which breaks down when 10+ orders come in during the first hour of a 4-hour market.

We need a system where:
1. The POS operator creates an order and shares a submission link with the customer
2. The customer submits pet photos and names from their own phone
3. The POS app shows the submitted photos alongside order details
4. Status updates are communicated automatically via text

## Scope

**v1**: Live drawings only — invoked when the order includes a live drawing product.
**v2**: All custom commissions (portraits from emailed photos, etc.)

---

## User Flow

### At the Market (POS Operator)

1. Create order with live drawing product(s)
2. Enter customer phone number and an estimated ready time
3. System sends the customer an SMS with a submission link
4. Customer submits pet profiles (photos + names)
5. POS app shows submissions on the order detail page
6. Artist completes drawing → operator marks as **Fulfilled**
7. System auto-texts customer: "Your drawing is ready! Come pick it up"
8. Customer picks up → operator marks as **Delivered**

### On Their Phone (Customer)

1. Receive SMS: _"Thanks for your order at Taylor Made! Submit your pet photos here: [link]"_
2. Tap link → mobile-friendly web page (no app install, no login)
3. For each pet:
   - Enter pet name
   - Upload 1–3 photos
4. Submit → see confirmation with order status + expected ready time
5. Receive text when drawing is done
6. Can text back to the same number with questions

---

## Constraints & Requirements

| Requirement | Detail |
|---|---|
| Max photos per pet | 3 |
| Max pets per live drawing line item | 2 |
| Ready time | Manually entered by POS operator, displayed to customer |
| SMS direction | Two-way — customer can reply to the same number |
| Cost model | Pay-per-use or generous free tier; low volume (~50-200 orders/month) |
| Customer auth | None — submission page is accessed via a unique tokenized link |
| Photo storage | Needs to persist beyond the market day |

---

## Architecture

### Components

```
┌─────────────────┐     SMS      ┌──────────────┐
│   POS App        │◄───────────►│   Customer    │
│   (React Native) │             │   (Phone)     │
└────────┬─────────┘             └──────┬────────┘
         │                              │
         │ Medusa Admin API             │ Web form (tokenized link)
         │                              │
┌────────▼──────────────────────────────▼────────┐
│              Medusa Backend                     │
│                                                 │
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ Order + Metadata │  │ Pet Submission Module │  │
│  └─────────────────┘  └──────────────────────┘  │
│                                                 │
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ File Service     │  │ SMS / Notification    │  │
│  │ (S3 / R2)       │  │ Service               │  │
│  └─────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Data Model

#### Pet Submission (custom Medusa module or metadata)

```typescript
interface PetSubmission {
  id: string
  order_id: string
  line_item_id: string        // which live drawing this pet is for
  submission_token: string    // unique token for the customer-facing URL
  pet_name: string
  photos: {
    id: string
    url: string               // S3/R2 URL
    uploaded_at: string
  }[]
  created_at: string
  updated_at: string
}
```

#### Order Metadata Extensions

```typescript
// Stored on the order or line item metadata
interface LiveDrawingMeta {
  estimated_ready_time: string   // ISO timestamp or "2:30 PM" — TBD
  submission_token: string       // for generating the customer link
  submission_complete: boolean   // customer has finished submitting
  sms_sent: {
    submission_link: boolean
    ready_notification: boolean
  }
}
```

**Open question**: Custom Medusa module vs. order/line-item metadata?
- **Metadata approach**: Simpler, no schema migrations, but photos as URLs in JSON feels fragile and hard to query
- **Custom module approach**: Proper relational model, queryable, but more setup. Medusa v2 modules are fairly lightweight to create
- **Recommendation**: Custom module for pet submissions (it's a real entity with relationships), metadata for the lightweight fields (ready time, sms flags)

### SMS / Messaging

**Evaluation of options**:

| Service | Free Tier | SMS Cost | Two-Way SMS | Notes |
|---|---|---|---|---|
| **Twilio** | None (trial credits) | ~$0.0079/msg | Yes, via phone number ($1.15/mo) | Industry standard, best docs |
| **AWS SNS** | 100 free SMS/mo (US) | ~$0.00645/msg | No (one-way only) | Cheapest but no replies |
| **Vonage** | $2 free credit | ~$0.0068/msg | Yes | Good alternative to Twilio |
| **Plivo** | $0.50 free credit | ~$0.0050/msg | Yes | Cheapest per-message |

**Recommendation: Twilio**
- Two-way SMS is a hard requirement (customer needs to text back)
- At ~100 orders/month = ~300 messages/month = **~$3.50/month** in SMS costs + $1.15/month for a phone number
- Total: **~$5/month** — very manageable
- Twilio webhooks make it easy to route inbound SMS to your phone or a dashboard
- Best documentation and Medusa community examples

**How two-way works**: You provision a Twilio phone number. Outbound messages come _from_ that number. When the customer replies, Twilio hits a webhook on your backend, which can forward the message to your personal phone (or a simple inbox in the POS app in the future).

### File Storage

Pet photos need to be stored somewhere accessible via URL.

| Service | Free Tier | Cost After | Notes |
|---|---|---|---|
| **Cloudflare R2** | 10GB storage, 10M reads/mo | $0.015/GB/mo | No egress fees, S3-compatible |
| **AWS S3** | 5GB for 12 months | $0.023/GB/mo + egress | Standard, more expensive |
| **Supabase Storage** | 1GB | $0.021/GB/mo | Simple, good DX |

**Recommendation: Cloudflare R2**
- Zero egress fees (huge for serving images)
- 10GB free = thousands of pet photos before you pay anything
- S3-compatible API, so Medusa's existing S3 file service plugin works with minimal config
- At ~100 orders/month × 2 pets × 3 photos × 2MB avg = ~1.2GB/month of uploads — well within free tier for a long time

### Customer-Facing Submission Page

A lightweight web page (not part of the React Native app). Options:

1. **Next.js page on the Medusa storefront** — if you already have one
2. **Standalone static page** (e.g., hosted on Cloudflare Pages) that calls the Medusa API
3. **Medusa API route that serves HTML** — simplest, no separate deploy

**Recommendation**: Depends on whether you have an existing storefront. A standalone page on Cloudflare Pages (free tier) would be the cheapest and simplest — a single-page React app or even plain HTML + vanilla JS that:
- Validates the submission token from the URL
- Shows a form: pet name + photo upload (repeatable, max 2 pets)
- Uploads photos directly to R2 (via presigned URLs from the backend)
- Shows order status + estimated ready time

---

## Implementation Phases

### Phase 1: Data Model + POS UI
- Create pet submission data model (custom module or metadata — decide first)
- Add "estimated ready time" input to order creation flow
- Display pet submissions on order detail page
- Generate submission tokens per order

### Phase 2: Customer Submission Page
- Build the web form for pet photo + name submission
- Photo upload to R2 via presigned URLs
- Submission validation (max pets, max photos)
- Status display (order status + ready time)

### Phase 3: SMS Integration
- Twilio setup (phone number, API keys)
- Send submission link on order creation
- Send "ready for pickup" notification on fulfillment status change
- Forward inbound customer texts to operator's phone

### Phase 4: Polish
- Photo thumbnails in POS order detail view
- Submission status indicators (submitted / pending)
- Error handling for failed uploads, expired links
- Rate limiting on the submission page

---

## Open Questions

1. **Where does the Medusa backend run?** Hosting choice affects whether we can add Twilio webhooks, custom API routes, etc. (Needs a server, not just serverless)
2. **Do you have a storefront already?** Affects where the submission page lives
3. **Should the estimated ready time be per-order or per-line-item?** (If someone orders 2 drawings, they might finish at different times)
4. **Photo size limits?** Should we resize/compress on upload to keep storage costs down?
5. **How long to keep photos?** Indefinitely, or auto-delete after 30/90 days?
6. **Custom module vs. metadata for pet submissions?** See tradeoffs above — recommend custom module but it's more initial work

---

## Cost Estimate (Monthly, ~100 orders)

| Service | Cost |
|---|---|
| Twilio phone number | $1.15 |
| Twilio SMS (~300 msgs) | ~$3.50 |
| Cloudflare R2 storage | $0 (free tier) |
| Cloudflare Pages hosting | $0 (free tier) |
| **Total** | **~$5/month** |
