require('dotenv').config();

const { execSync } = require('child_process');
const fs = require('fs').promises;
const knex = require('knex');

const db = knex({
    client: 'mysql',
    connection: {
        host : process.env.DB_HOST || 'localhost',
        port : +process.env.DB_PORT || 3306,
        user : process.env.DB_USER || 'root',
        password : process.env.DB_PASSWORD || '',
        database : process.env.DB_DATABASE || 'wordpress'
    }
});

const prefix = process.env.DB_TABLE_PREFIX || 'wp_';

const postQuery = `SELECT
        u.user_nicename as user_nicename,
        u.display_name as user_displayname,
        m1.meta_value as seo_description,
        m2.meta_value as seo_title,
        m3.meta_value as seo_focus_keyword,
        p.*
    FROM ${prefix}posts p
        LEFT JOIN ${prefix}users u ON u.ID = p.post_author
        LEFT JOIN ${prefix}postmeta m1 ON m1.post_id = p.ID AND m1.meta_key = '_yoast_wpseo_metadesc'
        LEFT JOIN ${prefix}postmeta m2 ON m2.post_id = p.ID AND m2.meta_key = '_yoast_wpseo_title'
        LEFT JOIN ${prefix}postmeta m3 ON m3.post_id = p.ID AND m3.meta_key = '_yoast_wpseo_focuskw'
    WHERE
        p.post_status = 'publish'
        AND p.post_type = 'post'
    ORDER BY p.post_date DESC`;

// via: https://stackoverflow.com/a/48000411
function urlify(url) {
    return url.toString()               // Convert to string
        .normalize('NFD')               // Change diacritics
        .replace(/[\u0300-\u036f]/g,'') // Remove illegal characters
        .replace(/\s+/g,'-')            // Change whitespace to dashes
        .toLowerCase()                  // Change to lowercase
        .replace(/&/g,'-and-')          // Replace ampersand
        .replace(/[^a-z0-9\-]/g,'')     // Remove anything that is not a letter, number or dash
        .replace(/-+/g,'-')             // Remove duplicate dashes
        .replace(/^-*/,'')              // Remove starting dashes
        .replace(/-*$/,'');             // Remove trailing dashes
}

function prepareContent(post, terms) {
    const date = new Date(post.post_date_gmt);
    const dateShort = date.toISOString().split('T')[0];

    const author = urlify(post.user_displayname);

    const category = terms.filter(t => t.taxonomy === 'category').find(x => true);

    const categories = terms.filter(t => t.taxonomy === 'category')
        .map(t => `\n  - ${t.term_name}`)
        .join('');

    const tags = terms.filter(t => t.taxonomy === 'post_tag')
        .map(t => `\n  - ${t.term_name}`)
        .join('');

    let contentType = 'article';
    
    if (category.term_name === 'Podcast' || category.term_name === 'the:procast') {
        contentType = 'podcast';
    } else if (terms.filter(t => t.taxonomy === 'category').map(x => x.term_name).includes('Wideo')) {
        contentType = 'youtube';
    }

    post.post_title = post.post_title.replace(/'/g, "\\'");
    post.seo_title = post.seo_title && post.seo_title.replace(/'/g, "\\'") || '';
    post.seo_description = post.seo_description && post.seo_description.replace(/'/g, "\\'") || '';

    post.post_content = post.post_content.replace(/alignleft/g, "align-left");

    return `---
title: '${post.post_title}'
url: ${post.post_name}
date: ${dateShort}
author: '${author}'
category: '${category.term_name}'
categories:${categories}
tags:${tags}
focus_keyword: '${post.seo_focus_keyword || ''}'
seo_title: '${post.seo_title || ''}'
seo_description: '${post.seo_description || ''}'
draft: false
content_type: '${contentType}'
---

${post.post_content}`;
}

async function storePost(post) {
    const date = new Date(post.post_date_gmt);
    const dateShort = date.toISOString().split('T')[0];

    const termsQuery = `SELECT p.ID, wt.name as term_name,t.taxonomy, p.post_title
        FROM ${prefix}posts p
            LEFT JOIN ${prefix}term_relationships r ON r.object_id=p.ID
            LEFT JOIN ${prefix}term_taxonomy t ON t.term_taxonomy_id = r.term_taxonomy_id
            LEFT JOIN ${prefix}terms wt on wt.term_id = t.term_id
        WHERE p.ID = ${post.ID}`

    const termsResults = await db.raw(termsQuery);
    const terms = termsResults[0] || [];

    await fs.writeFile(`posts/${dateShort}-${post.post_name}.md`, prepareContent(post, terms));
    console.log(`✅ ${post.post_title}`);
}

(async () => {
    try {
        console.log('⏳ Delete posts...');

        execSync('rm -rf posts/*', (error, stdout, stderr) => {
            if (error || stderr) {
                console.log('⛔️ Error during deleting posts.');
                return;
            }

            console.log('✅ Deleted posts.');
        });

        console.log(`⏳ Fetching data from database...\n`);

        const postResults = await db.raw(postQuery);
        const posts = postResults[0];

        await Promise.all(posts.map(post => storePost(post)));
        
        console.log(`\n👯‍♀️ DONE 🔥`);
        process.exit(0);
    } catch (ex) {
        console.log(`\n🙊 FAILED`, ex.message);
        process.exit(-1);
    }
})();