import Link from 'next/link';

export default function NotFound() {
  return <main><div className="page-head"><h1>Not found</h1><p><Link className="link" href="/">Back to Home</Link></p></div></main>;
}
