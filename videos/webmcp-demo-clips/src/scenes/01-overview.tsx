import {Circle, Layout, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutBack, easeOutCubic, sequence} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene, toolChip} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '01',
    kicker: 'The idea',
    title: 'WebMCP makes the page agent-native.',
    subtitle: 'A site exposes meaningful tools—not brittle coordinates or hidden automation.',
    payoff: 'The agent understands the workspace in the same terms as the person using it.',
  });
  const browser = createRef<Rect>();
  const connector = createRef<Line>();
  const agent = createRef<Rect>();
  const toolOne = createRef<Layout>();
  const toolTwo = createRef<Layout>();
  const toolThree = createRef<Layout>();

  view.add(
    <>
      <Rect
        ref={browser}
        x={-260}
        y={55}
        width={500}
        height={245}
        radius={22}
        fill={COLORS.paper}
        stroke={'#ffffff55'}
        lineWidth={2}
        scale={0.86}
        opacity={0}
        shadowColor={'#00000055'}
        shadowBlur={24}
      >
        <Rect y={-100} width={500} height={45} radius={[22, 22, 0, 0]} fill={'#e8ece6'} />
        <Circle x={-205} y={-100} width={10} height={10} fill={COLORS.orange} />
        <Circle x={-185} y={-100} width={10} height={10} fill={'#f4c95d'} />
        <Circle x={-165} y={-100} width={10} height={10} fill={'#69c77d'} />
        <Rect x={20} y={-100} width={350} height={25} radius={12} fill={COLORS.white}>
          <Txt text={'cutline.local'} fill={'#607068'} fontFamily={'monospace'} fontSize={12} />
        </Rect>
        <Txt x={-190} y={-35} text={'TIMELINE'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={15} />
        <Rect x={-35} y={25} width={390} height={38} radius={8} fill={'#b9d9c6'} />
        <Rect x={-105} y={25} width={6} height={38} fill={COLORS.orange} />
        <Rect x={-20} y={77} width={220} height={26} radius={6} fill={'#d2cee1'} />
        <Rect x={125} y={77} width={74} height={26} radius={6} fill={'#f5c5a9'} />
      </Rect>
      <Line
        ref={connector}
        points={[[18, 55], [155, 55]]}
        stroke={COLORS.lime}
        lineWidth={4}
        end={0}
        endArrow
        arrowSize={12}
      />
      <Rect
        ref={agent}
        x={285}
        y={55}
        width={170}
        height={170}
        radius={36}
        fill={COLORS.forestSoft}
        stroke={COLORS.lime}
        lineWidth={2}
        opacity={0}
        scale={0.7}
      >
        <Circle width={72} height={72} fill={COLORS.lime}>
          <Txt text={'AI'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={26} />
        </Circle>
        <Txt y={62} text={'AGENT'} fill={COLORS.paper} fontFamily={'Arial'} fontWeight={800} fontSize={15} letterSpacing={2} />
      </Rect>
      <Layout ref={toolOne} opacity={0} y={18}>{toolChip('inspect_project', 480, -8)}</Layout>
      <Layout ref={toolTwo} opacity={0} y={18}>{toolChip('apply_edit_batch', 500, 52, COLORS.orange)}</Layout>
      <Layout ref={toolThree} opacity={0} y={18}>{toolChip('preview_range', 482, 112, COLORS.lavender)}</Layout>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(browser().opacity(1, 1, easeOutCubic), browser().scale(1, 1, easeOutBack));
  yield* all(connector().end(1, 1.2, easeInOutCubic), agent().opacity(1, 1.2, easeOutCubic), agent().scale(1, 1.2, easeOutBack));
  yield* sequence(
    0.18,
    all(toolOne().opacity(1, 0.84, easeOutCubic), toolOne().position.y(0, 0.84, easeOutCubic)),
    all(toolTwo().opacity(1, 0.84, easeOutCubic), toolTwo().position.y(0, 0.84, easeOutCubic)),
    all(toolThree().opacity(1, 0.84, easeOutCubic), toolThree().position.y(0, 0.84, easeOutCubic)),
  );
  yield* animateOutro(chrome);
});
