// workflow-tweaks.jsx — Tweaks panel for the Operational Workflow Chart.
// Bridges tweak values to the vanilla chart via window.applyWorkflowTweaks().
const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSlider } = window;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "bright",
  "palette": "pastel",
  "font": "soft",
  "cards": "tinted",
  "radius": 18,
  "bg": "dots"
}/*EDITMODE-END*/;

function WorkflowTweaks() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    if (window.applyWorkflowTweaks) window.applyWorkflowTweaks(t);
  }, [t.theme, t.palette, t.font, t.cards, t.radius, t.bg]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Look" />
      <TweakRadio label="Mode" value={t.theme}
        options={[{ value: 'bright', label: 'Bright' }, { value: 'dark', label: 'Dark' }]}
        onChange={(v) => setTweak('theme', v)} />
      <TweakRadio label="Color palette" value={t.palette}
        options={[
          { value: 'pastel', label: 'Pastel' },
          { value: 'corporate', label: 'Corporate' },
          { value: 'sunset', label: 'Sunset' },
          { value: 'ocean', label: 'Ocean' }
        ]}
        onChange={(v) => setTweak('palette', v)} />
      <TweakRadio label="Typeface" value={t.font}
        options={[
          { value: 'soft', label: 'Soft' },
          { value: 'rounded', label: 'Rounded' },
          { value: 'modern', label: 'Modern' }
        ]}
        onChange={(v) => setTweak('font', v)} />

      <TweakSection label="Cards" />
      <TweakRadio label="Style" value={t.cards}
        options={[
          { value: 'tinted', label: 'Tinted' },
          { value: 'white', label: 'White' },
          { value: 'outline', label: 'Outline' }
        ]}
        onChange={(v) => setTweak('cards', v)} />
      <TweakSlider label="Corner radius" value={t.radius} min={4} max={26} step={1} unit="px"
        onChange={(v) => setTweak('radius', v)} />

      <TweakSection label="Canvas" />
      <TweakRadio label="Background" value={t.bg}
        options={[{ value: 'dots', label: 'Dots' }, { value: 'plain', label: 'Plain' }]}
        onChange={(v) => setTweak('bg', v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('tweaks-root')).render(<WorkflowTweaks />);
