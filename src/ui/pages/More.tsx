import { Link } from 'react-router-dom';
import { Upload, Scale, Shapes, Share2, History, Settings } from 'lucide-react';
import { PageHead } from '../components/Empty';

const ITEMS = [
  {
    to: '/import',
    icon: <Upload size={18} />,
    title: 'Import a bank file',
    sub: 'CSV, OFX or QFX from your bank',
  },
  {
    to: '/reconcile',
    icon: <Scale size={18} />,
    title: 'Reconcile',
    sub: 'Check the ledger against the bank statement',
  },
  {
    to: '/templates',
    icon: <Shapes size={18} />,
    title: 'Form templates',
    sub: 'SSA and court forms, and how to add yours',
  },
  {
    to: '/share',
    icon: <Share2 size={18} />,
    title: 'Share & backup',
    sub: 'Read-only copies, printed ledger, backups',
  },
  {
    to: '/activity',
    icon: <History size={18} />,
    title: 'Activity log',
    sub: 'Every change, hash-chained',
  },
  {
    to: '/settings',
    icon: <Settings size={18} />,
    title: 'Settings',
    sub: 'Book details, accounts, tags, this device',
  },
];

export function More() {
  return (
    <>
      <PageHead title="More" />
      <div className="card todo">
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to}>
            <span className="todo-icon">{i.icon}</span>
            <span className="grow">
              <span className="todo-title">{i.title}</span>
              <br />
              <span className="todo-sub">{i.sub}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
