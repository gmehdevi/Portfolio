import adapter from '@sveltejs/adapter-node';

const config = {
  compilerOptions: {
    runes: true
  },
  kit: {
    adapter: adapter(),
    alias: {
      $lib: 'src/lib'
    }
  }
};

export default config;
