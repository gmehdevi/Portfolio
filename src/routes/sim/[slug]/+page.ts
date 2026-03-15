import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getSimulationBySlug, listSimulations } from '$lib/simulation/registry';

export const prerender = true;

export const entries = () => {
	return listSimulations().map((sim) => ({ slug: sim.slug }));
};

export const load: PageLoad = ({ params }) => {
	const sim = getSimulationBySlug(params.slug);
	if (!sim) {
		throw error(404, 'Simulation not found');
	}
	return { slug: sim.slug };
};
