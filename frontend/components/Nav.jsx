import Link from 'next/link';
import { S } from '../lib/strings.js';

export default function Nav({ current }) {
  const items = [
    { key: 'dashboard', href: '/', label: S.nav.dashboard },
    { key: 'compare', href: '/comparacao', label: S.nav.compare },
  ];
  return (
    <nav className="nav" aria-label={S.nav.label}>
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? 'page' : undefined}
          className={i.key === current ? 'nav-link nav-active' : 'nav-link'}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
