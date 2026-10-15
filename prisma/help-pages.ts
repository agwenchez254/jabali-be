/** Help pages the storefront footer links to. Editable afterwards in the dashboard (Content > Pages). */
export const HELP_PAGES: { slug: string; title: string; blocks: Record<string, unknown>[] }[] = [
  {
    slug: 'delivery-and-returns',
    title: 'Delivery and returns',
    blocks: [
      { type: 'heading', text: 'Delivery' },
      { type: 'paragraph', text: 'We deliver across Kenya. The fee and delivery time depend on your county, and you see both at checkout before you pay.' },
      { type: 'list', items: ['Nairobi: same-day delivery if you order before 2 pm, otherwise next day.', 'Other counties: 2 to 5 working days.', 'Studio pickup is free and the order is ready in about 2 hours.'] },
      { type: 'heading', text: 'Returns' },
      { type: 'paragraph', text: 'If something does not fit, return it within 7 days, unworn and with its tags, and we will exchange it or refund you.' },
      { type: 'button', label: 'Track an order', href: '/track' },
    ],
  },
  {
    slug: 'size-guide',
    title: 'Size guide',
    blocks: [
      { type: 'heading', text: 'Finding your size' },
      { type: 'paragraph', text: 'Measure over a thin layer of clothing and keep the tape snug but not tight.' },
      { type: 'list', items: ['Chest: around the fullest part of your chest.', 'Waist: around your natural waistline.', 'Foot: heel to longest toe, then compare with the shoe size on the product page.'] },
      { type: 'paragraph', text: 'Between two sizes? Take the larger one for shirts and the smaller one for fitted blazers. Chat to us on WhatsApp if you would like a second opinion.' },
    ],
  },
  {
    slug: 'paying-with-mpesa',
    title: 'Paying with M-Pesa',
    blocks: [
      { type: 'heading', text: 'How it works' },
      { type: 'list', items: ['Choose M-Pesa at checkout and enter the number to charge.', 'You get a payment prompt on that phone. Enter your M-Pesa PIN to approve it.', 'Your order page updates as soon as the payment is confirmed.'] },
      { type: 'paragraph', text: 'No prompt? Open your order page and choose "Send the M-Pesa prompt again". Make sure the number has enough balance.' },
    ],
  },
];
