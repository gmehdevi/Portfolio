import adapter from '@sveltejs/adapter-static';

const base = process.env.NODE_ENV === 'production' ? '/Portfolio' : '';

const config = {
  compilerOptions: {
    runes: true
  },
  kit: {
    adapter: adapter(),
    paths: {
      base
    },
    alias: {
      $lib: 'src/lib'
    }
  }
};

export default config;
