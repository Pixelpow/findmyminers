import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return { redirect: { destination: '/miners', permanent: false } };
};

export default function Home() { return null; }
