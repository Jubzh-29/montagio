/**
 * The French names and descriptions of the camera moves, effects and hooks, by preset id. The
 * presets' YAML files hold the English ones (they are shared, CC-BY files); a name missing here
 * shows in English. test/catalog-fr.test.ts checks that every preset of the repository has one.
 */
export const CATALOG_FR: Record<string, { name: string; description: string }> = {
  // Camera moves
  breathing: { name: 'Respiration', description: 'Un avant-arrière à peine visible qui garde un plan fixe vivant.' },
  'crane-up': { name: 'Montée à la grue', description: 'Monte comme une grue pour révéler ce qui se trouve au-dessus du sujet.' },
  'crash-push': { name: 'Avancée éclair', description: 'Fonce vers le sujet et finit en plan serré.' },
  'drift-left-push': { name: 'Dérive gauche et avancée', description: 'Glisse vers la gauche en s’approchant doucement du sujet.' },
  'pan-left': { name: 'Travelling gauche', description: 'Glisse en douceur vers la gauche.' },
  'pan-right': { name: 'Travelling droite', description: 'Glisse en douceur vers la droite.' },
  'pull-back-reveal': { name: 'Recul révélateur', description: 'S’éloigne pour révéler la scène autour du sujet.' },
  'pull-back-tilt-up': { name: 'Recul et regard vers le ciel', description: 'S’éloigne en levant les yeux, et ouvre le plan sur le ciel.' },
  'push-and-settle': { name: 'Avancée puis arrêt', description: 'S’approche, puis se pose et tient le sujet.' },
  'rise-and-push': { name: 'Montée et avancée', description: 'S’élève au-dessus du sujet en s’en approchant.' },
  'slow-push': { name: 'Avancée lente', description: 'Avancée lente et régulière qui fait monter la tension.' },
  // Effects
  cakeify: { name: 'Gâteau', description: 'Un couteau tranche le sujet : c’était un gâteau depuis le début.' },
  explode: { name: 'Explosion', description: 'Le sujet éclate en une énorme explosion de flammes.' },
  'frozen-moment': { name: 'Instant figé', description: 'Le temps s’arrête pendant que la caméra tourne autour du sujet.' },
  'full-circle': { name: 'Tour complet', description: 'La caméra fait tout le tour du sujet.' },
  'snap-zoom': { name: 'Zoom éclair', description: 'Un zoom brutal fonce sur le sujet.' },
  squish: { name: 'Écrasé', description: 'Des mains aplatissent le sujet comme de la pâte à modeler.' },
  // Hooks
  figurine: { name: 'Figurine', description: 'Le sujet devient une figurine de collection.' },
  ignite: { name: 'Embrasement', description: 'Les flammes prennent et engloutissent le sujet.' },
  'iris-dive': { name: 'Plongée dans l’iris', description: 'La caméra plonge dans l’œil du sujet jusqu’à ce que l’iris remplisse l’image.' },
  'wardrobe-swap': { name: 'Changement de tenue', description: 'Les vêtements du sujet se changent en la tenue d’une seconde photo.' },
};
