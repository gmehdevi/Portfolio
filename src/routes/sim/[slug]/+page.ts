import type { PageLoad } from './$types';

const registry = {
	pendulum: {
		slug: 'pendulum',
		name: '3D Elastic Pendulum',
		description: 'Chain of masses with configurable stiffness, damping, and gravity.'
	}
};

export const load: PageLoad = ({ params }) => {
	const sim = registry[params.slug as keyof typeof registry];
	if (!sim) {
		return {
			status: 404,
			error: new Error('Simulation not found')
		};
	}
	return { sim };
};
