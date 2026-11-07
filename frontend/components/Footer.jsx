import { S } from '../lib/strings.js';

export default function Footer() {
  return (
    <footer className="footer">
      {S.footer.attribution}{' '}
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">{S.footer.source}</a>
      {' · '}
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">{S.footer.license}</a>
    </footer>
  );
}
