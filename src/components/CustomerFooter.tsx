import { Link } from 'react-router-dom';

const footerColumns = [
  {
    title: 'Shop',
    links: [
      { label: 'Skin Care', to: '/category/skin-care' },
      { label: 'Hair Care', to: '/category/hair-care' },
      { label: 'Personal & Body Care', to: '/category/personal-body-care' },
      { label: 'All Products', to: '/category/all' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Login', to: '/login' },
      { label: 'Register', to: '/register' },
      { label: 'Orders', to: '/orders' },
      { label: 'Wishlist', to: '/wishlist' },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Contact Us', to: '/info/contact-us' },
      { label: 'Shipping Policy', to: '/info/shipping-policy' },
      { label: 'Returns', to: '/info/returns' },
      { label: 'FAQ', to: '/info/faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About P&G', to: '/info/about-pg' },
      { label: 'Sustainability', to: '/info/sustainability' },
      { label: 'Careers', to: '/info/careers' },
      { label: 'Press', to: '/info/press' },
    ],
  },
];

export default function CustomerFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--secondary)]/70 py-10 text-[var(--foreground)]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 text-sm sm:px-6 md:grid-cols-4">
        {footerColumns.map(column => (
          <div key={column.title}>
            <h2 className="mb-3 font-semibold">{column.title}</h2>
            <ul className="flex flex-col gap-2">
              {column.links.map(link => (
                <li key={link.to}>
                  <Link to={link.to} className="text-[var(--foreground)]/75 transition-colors hover:text-[var(--primary)] hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col items-center justify-between gap-2 border-t border-[var(--border)] px-4 pt-6 sm:flex-row sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] font-display text-xs font-bold text-white">P</span>
          <span className="font-display text-sm">P&G Beauty</span>
        </Link>
        <p className="text-xs text-[var(--foreground)]/70">© 2026 Procter & Gamble. All rights reserved.</p>
      </div>
    </footer>
  );
}