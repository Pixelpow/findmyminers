import { GetServerSideProps } from 'next';

// La gestion de la flotte est fusionnée dans le Tableau de bord (vue unique).
// Le détail par mineur reste disponible sur /miners/[id].
export const getServerSideProps: GetServerSideProps = async () => {
  return { redirect: { destination: '/dashboard', permanent: false } };
};

export default function MinersIndex() { return null; }
