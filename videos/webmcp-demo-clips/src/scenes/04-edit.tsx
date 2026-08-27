import {Layout, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutBack, easeOutCubic, sequence} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '04',
    kicker: 'Semantic editing',
    title: 'Agents edit intent—not pixels.',
    subtitle: 'Split, trim, place B-roll, add transitions, and style captions through narrow tools.',
    payoff: 'One validated command bus powers both direct manipulation and WebMCP actions.',
  });
  const command = createRef<Rect>();
  const timeline = createRef<Rect>();
  const cutOne = createRef<Rect>();
  const cutTwo = createRef<Rect>();
  const transition = createRef<Layout>();
  const playhead = createRef<Rect>();

  view.add(
    <>
      <Rect ref={command} x={-400} y={35} width={330} height={220} radius={24} fill={'#071a16dd'} stroke={COLORS.orange} lineWidth={2} opacity={0} scale={0.82}>
        <Txt y={-78} text={'apply_edit_batch'} fill={COLORS.orange} fontFamily={'monospace'} fontWeight={800} fontSize={18} />
        <Layout y={-25}>
          <Rect width={270} height={38} radius={10} fill={'#ffffff0c'}><Txt text={'split  @  00:05.000'} fill={COLORS.paper} fontFamily={'monospace'} fontSize={14} /></Rect>
        </Layout>
        <Layout y={24}>
          <Rect width={270} height={38} radius={10} fill={'#ffffff0c'}><Txt text={'trim   end − 1.2s'} fill={COLORS.paper} fontFamily={'monospace'} fontSize={14} /></Rect>
        </Layout>
        <Layout y={73}>
          <Rect width={270} height={38} radius={10} fill={'#bff56c18'}><Txt text={'add_transition'} fill={COLORS.lime} fontFamily={'monospace'} fontSize={14} /></Rect>
        </Layout>
      </Rect>
      <Rect ref={timeline} x={190} y={35} width={610} height={250} radius={25} fill={COLORS.paper} opacity={0} scale={0.9}>
        <Txt x={-252} y={-98} text={'V1  VIDEO'} fill={'#607068'} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
        <Rect y={-48} width={520} height={55} radius={12} fill={'#e8ece6'}>
          <Rect ref={cutOne} x={-136} width={240} height={43} radius={9} fill={'#b9d9c6'}>
            <Txt text={'A-ROLL'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={14} />
          </Rect>
          <Rect ref={cutTwo} x={141} width={286} height={43} radius={9} fill={'#d9f1bc'}>
            <Txt text={'B-ROLL'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={14} />
          </Rect>
          <Layout ref={transition} x={0} opacity={0} scale={0.6}>
            <Rect width={54} height={54} rotation={45} radius={8} fill={COLORS.orange}>
              <Txt text={'⇄'} rotation={-45} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={19} />
            </Rect>
          </Layout>
        </Rect>
        <Txt x={-252} y={16} text={'CC  CAPTIONS'} fill={'#607068'} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
        <Rect y={62} width={520} height={40} radius={10} fill={'#eeebf5'}>
          <Txt text={'“One command. Visible result.”'} fill={'#544e61'} fontFamily={'Arial'} fontWeight={700} fontSize={15} />
        </Rect>
        <Rect ref={playhead} x={-250} y={10} width={4} height={182} radius={2} fill={COLORS.orange} />
      </Rect>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(command().opacity(1, 1, easeOutCubic), command().scale(1, 1, easeOutBack));
  yield* all(timeline().opacity(1, 1.2, easeOutCubic), timeline().scale(1, 1.2, easeOutBack), playhead().position.x(40, 1.2, easeInOutCubic));
  yield* sequence(
    0.16,
    all(cutOne().width(220, 0.88, easeInOutCubic), cutOne().position.x(-145, 0.88, easeInOutCubic)),
    all(cutTwo().position.x(150, 0.88, easeInOutCubic), transition().opacity(1, 0.88, easeOutCubic), transition().scale(1, 0.88, easeOutBack)),
    playhead().position.x(245, 0.88, easeInOutCubic),
  );
  yield* animateOutro(chrome);
});
