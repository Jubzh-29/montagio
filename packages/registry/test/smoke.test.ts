test('the package entry point imports', async () => {
  expect(await import('../src/index')).toBeDefined();
});
