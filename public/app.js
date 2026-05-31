const track = document.querySelector(".feature-track");

const prevBtn = document.querySelector(".prev-btn");
const nextBtn = document.querySelector(".next-btn");

const cards = document.querySelectorAll(".feature-card");

let currentIndex = 0;

/* DYNAMIC WIDTH */

function getCardWidth(){

    const card = cards[0];

    const style = window.getComputedStyle(track);

    const gap = parseInt(style.columnGap || style.gap);

    return card.offsetWidth + gap;
}

/* UPDATE */

function updateSlider(){

    const cardWidth = getCardWidth();

    track.style.transform =
        `translateX(-${currentIndex * cardWidth}px)`;
}

/* NEXT BUTTON */

nextBtn.addEventListener("click", () => {

    if(currentIndex < cards.length - 2){

        currentIndex++;

        updateSlider();
    }
});

/* PREV BUTTON */

prevBtn.addEventListener("click", () => {

    if(currentIndex > 0){

        currentIndex--;

        updateSlider();
    }
});

/* AUTO SLIDE */

setInterval(() => {

    if(currentIndex < cards.length - 2){

        currentIndex++;

    }else{

        currentIndex = 0;
    }

    updateSlider();

},3000);


